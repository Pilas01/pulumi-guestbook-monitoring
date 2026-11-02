# Pulumi Kubernetes Guestbook with Prometheus and Grafana Monitoring

## Overview

This project extends the Pulumi Kubernetes Guestbook example by adding application and infrastructure monitoring using Prometheus and Grafana.

The solution deploys:

- Guestbook frontend
- Redis leader and replicas
- Prometheus
- Grafana
- kube-state-metrics
- Prometheus Node Exporter
- Redis Exporter
- Prometheus Blackbox Exporter
- A preconfigured Grafana dashboard for Guestbook monitoring

The monitoring stack is deployed using Pulumi and Helm.

## Architecture

```text
Guestbook Frontend
        |
        | HTTP Probe
        v
Blackbox Exporter
        |
        v
Prometheus
        |
        v
Grafana


Redis Leader
        |
        v
Redis Exporter
        |
        v
Prometheus
        |
        v
Grafana


Kubernetes Pods / Nodes
        |
        v
kube-state-metrics / Node Exporter
        |
        v
Prometheus
        |
        v
Grafana
```

## Monitoring Approach

The original Guestbook frontend does not expose a native Prometheus `/metrics` endpoint.

Instead of modifying the application source code, this implementation uses:

- **Blackbox Exporter** to monitor frontend availability, HTTP response status, and response time.
- **Redis Exporter** to expose Redis-specific metrics.
- **kube-prometheus-stack** to collect Kubernetes workload, CPU, memory, and infrastructure metrics.

This allows the original Guestbook application to remain unchanged while still providing meaningful application and infrastructure monitoring.

## Prerequisites

Install the following tools:

- Git
- Node.js and npm
- Docker Desktop
- Kubernetes
- kubectl
- Pulumi CLI
- Helm

Verify the installation:

```bash
git --version
node --version
npm --version
docker --version
kubectl version --client
pulumi version
helm version
```

A Kubernetes cluster must also be available.

This project was tested using Docker Desktop Kubernetes.

Verify the cluster:

```bash
kubectl get nodes
```

The node should have a status of:

```text
Ready
```

## Install Dependencies

From the project directory:

```bash
npm install
```

On Windows PowerShell, if npm execution is blocked, use:

```bash
npm.cmd install
```

## Pulumi Login

Login to Pulumi:

```bash
pulumi login
```

Verify:

```bash
pulumi whoami
```

## Create or Select Stack

Create the development stack:

```bash
pulumi stack init dev
```

If the stack already exists:

```bash
pulumi stack select dev
```

## Configure Grafana Password

Set the Grafana administrator password as a Pulumi secret:

```bash
pulumi config set --secret grafanaAdminPassword guestbook-admin
```

The password is stored as a Pulumi secret rather than plain text in the stack configuration.

## Preview Deployment

Before deploying:

```bash
pulumi preview
```

Review the proposed Kubernetes and Helm resources.

## Deploy

Deploy the complete environment:

```bash
pulumi up
```

Select:

```text
yes
```

Pulumi deploys the Guestbook application and monitoring components.

## Verify Guestbook

Check the application workloads:

```bash
kubectl get pods
```

Check the Guestbook services:

```bash
kubectl get svc
```

The main services include:

```text
frontend
redis-leader
redis-replica
```

To access the Guestbook locally:

```bash
kubectl port-forward svc/frontend 8080:80
```

Open:

```text
http://localhost:8080
```

## Verify Monitoring Components

Check the monitoring namespace:

```bash
kubectl get pods -n monitoring
```

Expected components include:

```text
Grafana
Prometheus
Prometheus Operator
kube-state-metrics
Prometheus Node Exporter
Redis Exporter
Blackbox Exporter
Alertmanager
```

All pods should eventually show:

```text
Running
```

## Grafana Access

Grafana is exposed as a Kubernetes NodePort service.

Check the service:

```bash
kubectl get svc -n monitoring
```

The Grafana service should appear similar to:

```text
monitoring-grafana   NodePort   ...   80:32000/TCP
```

For reliable local access, use port forwarding:

```bash
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

Open:

```text
http://localhost:3000
```

### Grafana Credentials

Username:

```text
admin
```

The password can be retrieved from Pulumi:

```bash
pulumi stack output grafanaPassword --show-secrets
```

Other Grafana outputs:

```bash
pulumi stack output
```

Example:

```text
frontendIp       172.18.0.5
grafanaPassword  [secret]
grafanaUrl       http://localhost:3000
grafanaUsername  admin
```

## Prometheus Access

Port-forward Prometheus:

```bash
kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090:9090
```

Open:

```text
http://localhost:9090
```

Prometheus can then be used to verify that the Guestbook metrics are being scraped successfully.

## Verify Redis Monitoring

Redis metrics are exposed through Prometheus Redis Exporter.

Run the following Prometheus query:

```promql
redis_up
```

Expected result:

```text
1
```

Additional useful Redis metrics:

```promql
redis_connected_clients
```

```promql
redis_commands_processed_total
```

A value of `redis_up = 1` confirms that the Redis exporter can successfully communicate with the Guestbook Redis backend.

## Verify Frontend Monitoring

The Guestbook frontend is monitored using Prometheus Blackbox Exporter.

Run:

```promql
probe_success
```

Expected result:

```text
1
```

This confirms that the Guestbook frontend is reachable.

Check the returned HTTP status:

```promql
probe_http_status_code
```

Expected:

```text
200
```

Check frontend response time:

```promql
probe_duration_seconds
```

The Blackbox Exporter probes:

```text
http://frontend.default.svc.cluster.local
```

## Kubernetes Resource Monitoring

The Prometheus stack also collects Kubernetes workload metrics.

### Frontend CPU

```promql
sum(
  rate(
    container_cpu_usage_seconds_total{
      namespace="default",
      pod=~"frontend.*",
      container!="",
      container!="POD"
    }[5m]
  )
)
```

### Frontend Memory

```promql
sum(
  container_memory_working_set_bytes{
    namespace="default",
    pod=~"frontend.*",
    container!="",
    container!="POD"
  }
)
```

These metrics provide resource-usage visibility for the Guestbook frontend pods.

## Verify Prometheus Targets

In Prometheus, navigate to:

```text
Status → Targets
```

The Redis exporter and Guestbook frontend Blackbox target should appear as healthy targets.

The following commands can also be used to inspect the ServiceMonitor resources:

```bash
kubectl get servicemonitor -n monitoring
```

Expected custom ServiceMonitors include:

```text
redis-exporter-prometheus-redis-exporter
blackbox-exporter-prometheus-blackbox-exporter-guestbook-frontend
```

## Grafana Dashboard

A Grafana dashboard is automatically provisioned through a Kubernetes ConfigMap.

Open:

```text
Dashboards → Guestbook Monitoring
```

The dashboard displays:

- Frontend Availability
- Frontend Response Time
- Redis Status
- Redis Connected Clients
- Frontend CPU Usage
- Frontend Memory Usage

Example metrics include:

```promql
probe_success
```

```promql
probe_duration_seconds
```

```promql
redis_up
```

```promql
redis_connected_clients
```

```promql
container_cpu_usage_seconds_total
```

```promql
container_memory_working_set_bytes
```

## Design Decisions

### Prometheus and Grafana

The `kube-prometheus-stack` Helm chart is deployed through Pulumi.

This provides:

- Prometheus
- Grafana
- Prometheus Operator
- kube-state-metrics
- Node Exporter
- Alertmanager

### Redis Monitoring

The Guestbook backend uses Redis, which does not directly expose Prometheus-formatted metrics.

Prometheus Redis Exporter translates Redis statistics into Prometheus-compatible metrics.

### Frontend Monitoring

The existing Guestbook frontend does not expose a native `/metrics` endpoint.

A ServiceMonitor alone does not create metrics. It only tells Prometheus where an existing metrics endpoint is located.

Because the Guestbook application does not expose such an endpoint, Blackbox Exporter is used to perform HTTP probes against the frontend.

This provides service-level indicators such as:

- Availability
- HTTP response code
- Response time

For a production application where the source code is under our control, the next improvement would be native application instrumentation for metrics such as request rate, error rate, and latency.

### Grafana Service

Grafana initially used a `LoadBalancer` service.

Because the project was tested on a local Docker Desktop Kubernetes cluster, LoadBalancer provisioning was not reliable. The service was therefore changed to `NodePort`, which is also supported by the assignment requirements.

Port forwarding is used for reliable local browser access.

## Troubleshooting

### Grafana or Prometheus takes a long time to start

The monitoring stack may take several minutes the first time because Kubernetes needs to download multiple container images.

Check status with:

```bash
kubectl get pods -n monitoring
```

### Prometheus Helm Release Timeout

If the first deployment times out while images are still downloading, inspect:

```bash
kubectl get pods -n monitoring
```

and:

```bash
kubectl get events -n monitoring --sort-by=.lastTimestamp
```

The Pulumi Helm release uses an extended timeout to allow the monitoring stack enough time to initialize.

### Blackbox Metrics Return No Data

Verify the ServiceMonitor:

```bash
kubectl get servicemonitor -n monitoring
```

The Blackbox ServiceMonitor uses:

```text
interval: 60s
scrapeTimeout: 30s
```

The scrape interval must be greater than the scrape timeout.

### Inspect Redis Exporter

```bash
helm status redis-exporter -n monitoring
```

### Inspect Blackbox Exporter

```bash
kubectl get pods -n monitoring
```

Test Blackbox manually:

```bash
kubectl port-forward -n monitoring svc/blackbox-exporter-prometheus-blackbox-exporter 9115:9115
```

Then visit:

```text
http://localhost:9115/probe?target=http://frontend.default.svc.cluster.local&module=http_2xx
```

The output should contain:

```text
probe_success 1
```

## Cleanup

Destroy all resources created by Pulumi:

```bash
pulumi destroy
```

Confirm the deletion when prompted.

Optionally remove the stack:

```bash
pulumi stack rm dev
```

## Summary

This project demonstrates how Pulumi can be used to deploy both an application and its monitoring infrastructure.

The final solution provides:

- Kubernetes-based Guestbook deployment
- Infrastructure-as-Code using Pulumi
- Prometheus metrics collection
- Grafana visualization
- Redis backend monitoring
- Frontend availability monitoring
- Kubernetes CPU and memory metrics
- Secure Grafana credentials through Pulumi secrets
- Automated Grafana dashboard provisioning