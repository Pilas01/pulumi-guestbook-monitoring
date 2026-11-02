// Copyright 2016-2025, Pulumi Corporation.  All rights reserved.

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// Minikube does not implement services of type `LoadBalancer`; require the user to specify if we're
// running on minikube, and if so, create only services of type ClusterIP.
const config = new pulumi.Config();
const isMinikube = config.getBoolean("isMinikube");

//
// REDIS LEADER.
//

const redisLeaderLabels = { app: "redis-leader" };
const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
    spec: {
        selector: { matchLabels: redisLeaderLabels },
        template: {
            metadata: { labels: redisLeaderLabels },
            spec: {
                containers: [
                    {
                        name: "redis-leader",
                        image: "redis",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        ports: [{ containerPort: 6379 }],
                    },
                ],
            },
        },
    },
});
const redisLeaderService = new k8s.core.v1.Service("redis-leader", {
    metadata: {
        name: "redis-leader",
        labels: redisLeaderDeployment.metadata.labels,
    },
    spec: {
        ports: [{ port: 6379, targetPort: 6379 }],
        selector: redisLeaderDeployment.spec.template.metadata.labels,
    },
});

//
// REDIS REPLICA.
//

const redisReplicaLabels = { app: "redis-replica" };
const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
    spec: {
        selector: { matchLabels: redisReplicaLabels },
        template: {
            metadata: { labels: redisReplicaLabels },
            spec: {
                containers: [
                    {
                        name: "replica",
                        image: "pulumi/guestbook-redis-replica",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        // If your cluster config does not include a dns service, then to instead access an environment
                        // variable to find the leader's host, change `value: "dns"` to read `value: "env"`.
                        env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                        ports: [{ containerPort: 6379 }],
                    },
                ],
            },
        },
    },
});
const redisReplicaService = new k8s.core.v1.Service("redis-replica", {
    metadata: {
        name: "redis-replica",
        labels: redisReplicaDeployment.metadata.labels,
    },
    spec: {
        ports: [{ port: 6379, targetPort: 6379 }],
        selector: redisReplicaDeployment.spec.template.metadata.labels,
    },
});

//
// FRONTEND
//

const frontendLabels = { app: "frontend" };
const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    spec: {
        selector: { matchLabels: frontendLabels },
        replicas: 3,
        template: {
            metadata: { labels: frontendLabels },
            spec: {
                containers: [
                    {
                        name: "frontend",
                        image: "pulumi/guestbook-php-redis",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        // If your cluster config does not include a dns service, then to instead access an environment
                        // variable to find the master service's host, change `value: "dns"` to read `value: "env"`.
                        env: [{ name: "GET_HOSTS_FROM", value: "dns" /* value: "env"*/ }],
                        ports: [{ containerPort: 80 }],
                    },
                ],
            },
        },
    },
});
const frontendService = new k8s.core.v1.Service("frontend", {
    metadata: {
        labels: frontendDeployment.metadata.labels,
        name: "frontend",
    },
    spec: {
        type: isMinikube ? "ClusterIP" : "LoadBalancer",
        ports: [{ port: 80 }],
        selector: frontendDeployment.spec.template.metadata.labels,
    },
});

// Export the frontend IP.
export let frontendIp: pulumi.Output<string>;
if (isMinikube) {
    frontendIp = frontendService.spec.clusterIP;
} else {
    frontendIp = frontendService.status.loadBalancer.ingress[0].ip;
}

const monitoringNamespace = new k8s.core.v1.Namespace("monitoring", {
    metadata: {
        name: "monitoring",
    },
});

const grafanaAdminUser = "admin";
const grafanaAdminPassword = config.requireSecret("grafanaAdminPassword");

const monitoring = new k8s.helm.v3.Release("monitoring", {
    name: "monitoring",
    namespace: monitoringNamespace.metadata.name,
    chart: "kube-prometheus-stack",
    timeout: 900,

    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    },

    values: {
        grafana: {
            adminUser: grafanaAdminUser,
            adminPassword: grafanaAdminPassword,
            service: {
                type: "NodePort",
                nodePort: 32000,
           },
        },

        prometheus: {
            prometheusSpec: {
                serviceMonitorSelectorNilUsesHelmValues: false,
                podMonitorSelectorNilUsesHelmValues: false,
            },
        },
    },
}, {
    dependsOn: monitoringNamespace,
});

const redisExporter = new k8s.helm.v3.Release("redis-exporter", {
    name: "redis-exporter",
    namespace: monitoringNamespace.metadata.name,
    chart: "prometheus-redis-exporter",

    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    },

    values: {
        redisAddress: "redis://redis-leader.default.svc.cluster.local:6379",

        serviceMonitor: {
            enabled: true,
            labels: {
                release: "monitoring",
            },
            interval: "15s",
        },
    },
}, {
    dependsOn: monitoring,
});

const blackboxExporter = new k8s.helm.v3.Release("blackbox-exporter", {
    name: "blackbox-exporter",
    namespace: monitoringNamespace.metadata.name,
    chart: "prometheus-blackbox-exporter",

    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    },

    values: {
        serviceMonitor: {
            enabled: true,

            defaults: {
                labels: {
                    release: "monitoring",
                },
                interval: "60s",
                module: "http_2xx",
            },

            targets: [
                {
                    name: "guestbook-frontend",
                    url: "http://frontend.default.svc.cluster.local",
                    module: "http_2xx",
                },
            ],
        },
    },
}, {
    dependsOn: monitoring,
});

export const grafanaUsername = grafanaAdminUser;
export const grafanaPassword = grafanaAdminPassword;
export const grafanaUrl = "http://localhost:3000";


const guestbookDashboard = new k8s.core.v1.ConfigMap("guestbook-dashboard", {
    metadata: {
        name: "guestbook-dashboard",
        namespace: monitoringNamespace.metadata.name,
        labels: {
            grafana_dashboard: "1",
        },
    },
    data: {
        "guestbook-dashboard.json": JSON.stringify({
            title: "Guestbook Monitoring",
            uid: "guestbook-monitoring",
            schemaVersion: 39,
            version: 1,
            refresh: "30s",

            panels: [
                {
                    title: "Frontend Availability",
                    type: "stat",
                    gridPos: { x: 0, y: 0, w: 6, h: 5 },

                    targets: [
                        {
                            expr: 'probe_success{target="guestbook-frontend"}',
                            refId: "A",
                        },
                    ],

                    fieldConfig: {
                        defaults: {
                            min: 0,
                            max: 1,
                        },
                    },
                },

                {
                    title: "Frontend Response Time",
                    type: "timeseries",
                    gridPos: { x: 6, y: 0, w: 6, h: 5 },

                    targets: [
                        {
                            expr: 'probe_duration_seconds{target="guestbook-frontend"}',
                            refId: "A",
                        },
                    ],
                },

                {
                    title: "Redis Status",
                    type: "stat",
                    gridPos: { x: 12, y: 0, w: 6, h: 5 },

                    targets: [
                        {
                            expr: "redis_up",
                            refId: "A",
                        },
                    ],

                    fieldConfig: {
                        defaults: {
                            min: 0,
                            max: 1,
                        },
                    },
                },

                {
                    title: "Redis Connected Clients",
                    type: "timeseries",
                    gridPos: { x: 18, y: 0, w: 6, h: 5 },

                    targets: [
                        {
                            expr: "redis_connected_clients",
                            refId: "A",
                        },
                    ],
                },

                {
                    title: "Frontend CPU Usage",
                    type: "timeseries",
                    gridPos: { x: 0, y: 5, w: 12, h: 6 },

                    targets: [
                        {
                            expr: `sum(
                                rate(
                                    container_cpu_usage_seconds_total{
                                        namespace="default",
                                        pod=~"frontend.*",
                                        container!="",
                                        container!="POD"
                                    }[5m]
                                )
                            )`,
                            refId: "A",
                        },
                    ],
                },

                {
                    title: "Frontend Memory Usage",
                    type: "timeseries",
                    gridPos: { x: 12, y: 5, w: 12, h: 6 },

                    targets: [
                        {
                            expr: `sum(
                                container_memory_working_set_bytes{
                                    namespace="default",
                                    pod=~"frontend.*",
                                    container!="",
                                    container!="POD"
                                }
                            )`,
                            refId: "A",
                        },
                    ],
                },
            ],
        }),
    },
}, {
    dependsOn: monitoring,
});