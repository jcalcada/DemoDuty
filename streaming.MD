# Streaming API Service SRE Playbook (Fictional Example)

Status: Draft  
Last Updated: 2025-08-11  
Service Owners: DevOps / Platform Reliability Team  
Primary On-Call Rotation: `streaming-api-primary` (PagerDuty Schedule)  
Secondary Rotation: `platform-escalation`  

---

## 1. Purpose

This playbook provides standardized procedures to:
- Detect, triage, mitigate, and resolve production issues impacting the Streaming API platform.
- Maintain agreed SLOs and reduce MTTA / MTTR.
- Enable consistent incident communication and post-incident learning.

---

## 2. Scope

Covers the externally facing HTTPS Streaming API (real-time market/events feed) and its ingestion, enrichment, and distribution pipeline.

Out of scope (separate playbooks): Billing, User Portal, ML Ranking Service.

---

## 3. High-Level Architecture (Fictional)

```
[ Producers ] ---> [ Ingestion NLB ] ---> [ API Gateway Layer ]
                                      |-> Auth Service (OIDC/JWT)
                                      |-> Rate Limiter (Redis/Memcached)

[ API Gateway ] ---> [ Stream Orchestrator Service ] ---> [ Kafka (3 AZ cluster) ]
                                                   |--> Metrics Annotation Service
                                                   |--> Backpressure Controller

[ Consumers ] <---(WebSocket / SSE / Long-Poll)-- [ Edge API Nodes (EC2 ASG) ]
                                        |
                                     [ Cache Layer (Redis cluster) ]
                                        |
                                     [ PostgreSQL (Aurora) - session/meta ]
                                        |
                                [ Object Store (S3) for replay / snapshots ]

Observability:
- Traces: OpenTelemetry -> Collector -> Tempo
- Metrics: Prometheus (federated) + CloudWatch
- Logs: Fluent Bit -> OpenSearch / ELK
- Alerts: Alertmanager -> PagerDuty
- Dashboards: Grafana
```

Deployment:
- Rolling blue/green via CodeDeploy + Auto Scaling Groups
- AMI baked with Packer; config via SSM Parameter Store
- Feature flags via LaunchDarkly (mocked)

---

## 4. Service Level Objectives (SLOs)

| SLI Category | SLI Definition | Target SLO | Measurement Window | Error Budget |
|--------------|----------------|-----------|--------------------|--------------|
| Availability | Successful API requests / total (HTTP 2xx, 101; exclude 4xx client errors) | 99.9% | 30 days | 0.1% (~43.2 min) |
| Stream Delivery Latency | P50 end-to-end event publish-to-client < 500ms | 95% of events | 30 days | 5% |
| Stream Delivery Latency | P95 < 1500ms | 99% | 30 days | 1% |
| Error Rate | 5xx rate < 0.2% | 99.8% success | 30 days | 0.2% |
| Throttle Accuracy | <= 1% incorrectly throttled | 99% accuracy | 30 days | 1% |
| Data Freshness | Kafka consumer lag < 5k msgs | 99% of 1-min intervals | 30 days | 1% |

---

## 5. Key Metrics & Example Prometheus Queries

| Metric / Purpose | Example PromQL |
|------------------|----------------|
| Request Rate | sum(rate(api_http_requests_total{service="streaming-api"}[5m])) |
| Error Rate (5xx) | sum(rate(api_http_requests_total{service="streaming-api",status=~"5.."}[5m])) / sum(rate(api_http_requests_total{service="streaming-api"}[5m])) |
| Auth Failures | sum(rate(api_http_requests_total{auth="failure"}[5m])) |
| P99 Latency | histogram_quantile(0.99, sum(rate(api_request_duration_seconds_bucket{service="streaming-api"}[5m])) by (le)) |
| Kafka Consumer Lag | max(kafka_consumer_group_lag{group="stream-dispatcher"}) |
| Redis Hit Ratio | sum(rate(redis_keyspace_hits_total[5m])) / (sum(rate(redis_keyspace_hits_total[5m])) + sum(rate(redis_keyspace_misses_total[5m]))) |
| Node Saturation (CPU) | avg(node_cpu_utilization{role="edge-api"}) |
| Memory RSS | avg(container_memory_rss{pod=~"streaming-api.*"}) |
| GC Pause | max(rate(jvm_gc_pause_seconds_sum[5m])) |
| Rate Limit Nearing | sum(rate(rate_limiting_decisions_total{decision="will_limit"}[1m])) |
| Open WebSocket Sessions | sum(streaming_active_sessions) |
| Backpressure Trips | increase(backpressure_activation_total[15m]) |

---

## 6. Alert Matrix (Representative)

| Alert Name | Condition | Severity | Initial Action |
|------------|-----------|----------|----------------|
| High 5xx Error Rate | 5xx ratio > 2% 5m | Critical | Run 5xx runbook |
| Latency Degradation | P95 latency > 2s 10m | High | Latency runbook |
| Consumer Lag Spike | Lag > 25k msgs 5m | High | Kafka lag runbook |
| Auth Failures Surge | Auth failures > 5% 5m | Medium | Auth runbook |
| Throttle Over-fire | Incorrect throttle > 3% 10m | Medium | Rate limiter runbook |
| Edge Node Saturation | CPU > 85% & load > vCPU*1.2 10m | Medium | Capacity / ASG check |
| Redis Hit Ratio Drop | Hit ratio < 80% 10m | Medium | Cache degradation |
| Deployment Errors | >3 failed health checks new version 5m | Critical | Rollback runbook |
| Backpressure Frequent | >5 activations 15m | Low | Investigate upstream surge |
| Certificate Expiry | Cert expiry < 14d | Low | Rotate certificate |

---

## 7. Triage Workflow (Generic)

1. Acknowledge alert in PagerDuty within 5 minutes.
2. Identify incident type (Error rate, Latency, Capacity, Dependency, Security).
3. Declare Incident (if Sev1/Sev2) in Incident Channel: `#inc-streaming-api-<date>-<id>`.
4. Assign roles:
   - Incident Commander (IC)
   - Communications Lead
   - Ops / Resolver
   - Scribe
5. Gather evidence:
   - Grafana dashboard: Streaming API – Overview
   - Recent deploy? (confirm in deploy log / CodeDeploy)
   - Correlate with CloudWatch events / scaling / feature flags.
6. Mitigate (stop error budget bleed) before deep root cause.
7. Communicate every 15 min (Sev1) / 30 min (Sev2).
8. Resolve: verify KPIs stable 15 min.
9. Post-Incident Review (PIR) scheduled within 72 hours.

---

## 8. Runbooks

### 8.1 Elevated 5xx Error Rate

Symptoms:
- Alert: High 5xx Error Rate
- API clients reporting 500 / 503 / 504
- Logs show stack traces, timeouts

Immediate Checks:
1. Grafana panel: Error Rate – split by status_code
2. Determine dominant code: 500 vs 503 vs 504
3. Recent deployment? (within 30m)
4. Dependency health (Auth, Redis, Kafka)
5. Instance distribution (one AZ?)

Commands / Queries:
```
# Sample log filter (OpenSearch)
kubernetes.namespace:streaming AND level:ERROR AND @timestamp:[now-5m TO now]
```
```
# Check edge node error distribution
kubectl logs -l app=streaming-api --since=5m | grep "ERROR" | wc -l
```
```
# Health of Kafka brokers
kafka-topics.sh --describe --topic events-stream --bootstrap-server $BROKERS
```
Mitigation Paths:
- If tied to latest deploy: initiate rollback (see runbook 8.7)
- If dependency timeout (Redis):
  - Fail open for non-critical enrichment (toggle `FEATURE_ENRICHMENT_BYPASS=true` via feature flag)
- If surge traffic:
  - Confirm autoscaling events; manually increase desired capacity (+30%) in ASG
- If specific pod misbehaving:
  - Drain & restart: `kubectl delete pod <pod>`

Escalate:
- Platform team if Redis / Kafka cluster impairment
- Security if spike correlated with suspicious origins

Exit Criteria:
- 5xx ratio < 0.5% sustained 15 min

---

### 8.2 Latency Spike

Symptoms:
- P95 > 2s
- Clients experiencing delayed event delivery
- Kafka lag may or may not be involved

Steps:
1. Break down latency layers (Gateway -> App -> Downstream).
2. Check application percentile histogram (`api_request_duration_seconds_bucket`).
3. Examine GC pauses / memory pressure.
4. Evaluate queue depth / thread pool saturation.
5. Inspect Kafka consumer lag.

PromQL Aids:
```
sum by (phase)(rate(jvm_gc_pause_seconds_sum{service="streaming-api"}[5m]))
max(threadpool_active_threads{pool="dispatch-executor"})
```
Potential Mitigations:
- Enable adaptive sampling to reduce overhead: feature flag `TRACE_SAMPLING_MODE=degraded`
- Increase consumer parallelism: scale `stream-dispatcher` deployment replicas +1 or +2
- Clear hot partitions (rebalance): run partition reassignment if skew observed
- Temporarily reduce enrichment modules (set `ENRICH_LEVEL=basic`)

Rollback only if latency correlates directly with a new build path.

Exit:
- P95 < threshold for 15 minutes; no backlog growth.

---

### 8.3 Authentication Failures Surge

Symptoms:
- Elevated 401 / 403 beyond baseline
- `auth="failure"` metric rising

Steps:
1. Determine if due to client misconfiguration or internal auth service issue.
2. Check auth service health endpoint: `curl https://auth.internal/healthz`
3. Inspect JWT validation errors in logs.
4. Confirm time skew on nodes (NTP drift).

Mitigations:
- If certificate / JWKS fetch failing: refresh cache `kubectl exec <pod> -- curl -XPOST localhost:9000/refresh-jwks`
- If NTP drift >2s: restart chrony / investigate host
- Communicate to clients if widespread token expiration pattern.

Exit:
- Failure rate returns to baseline (<1%) 10 min.

---

### 8.4 Throttling / Rate Limiting Anomalies

Symptoms:
- Increase in 429 responses
- Legitimate clients complaining of unjust throttles

Checks:
1. Monitor `rate_limiting_decisions_total` by decision dimension.
2. Validate Redis latency / CPU (rate limiter backend).
3. Review recent config change to rate tiers.
4. Inspect hot key cardinality.

Mitigations:
- Flush misconfigured bucket: `redis-cli DEL rl:tenant:<id>`
- Temporarily raise burst capacity 20% for impacted tier.
- Revert recent limiter config (stored in SSM parameter `/streaming/ratelimits.yaml`).

Exit:
- Incorrect throttle metric < 1% for 15 min.

---

### 8.5 Kafka Consumer Lag

Symptoms:
- `kafka_consumer_group_lag` > threshold
- Event delivery delayed

Checks:
1. Identify partitions with highest lag.
2. Evaluate consumer CPU / thread saturation.
3. Look for broker ISR changes.
4. Check for large messages or compression ratio anomalies.

Commands:
```
kafka-consumer-groups.sh --bootstrap-server $BROKERS --describe --group stream-dispatcher
kafka-topics.sh --describe --topic events-stream --bootstrap-server $BROKERS | grep -i isr
```

Mitigations:
- Scale consumer deployment.
- Increase max.poll.interval.ms if rebalancing storms.
- Add temporary consumer group (shadow) to drain backlog (ensure idempotency).
- If broker issue: escalate to Data Platform.

Exit:
- Lag < 5k for 15 min and trending downward.

---

### 8.6 Dependency Degradation (Redis / DB / External API)

Steps:
1. Identify which calls timing out (tracing spans).
2. Check connection pool saturation.
3. For Redis: `INFO stats` for evictions, `used_memory_peak`.
4. For Aurora: check CloudWatch CPU, connections, deadlocks.

Mitigations:
- Enable circuit breaker for failing downstream.
- Increase connection pool if under-provisioned but DB healthy.
- Reduce enrichment calls (feature toggle).
- Fail over to read replica (Aurora) if primary impaired.

Exit:
- Downstream latency restored < baseline * 1.2.

---

### 8.7 Deployment Rollback

Trigger:
- Elevated 5xx or health check failures tied to latest release.

Procedure:
1. Identify deployment ID: CodeDeploy console or `codedeploy-agent` logs.
2. Mark incident channel with intent to rollback.
3. Execute Blue/Green revert:
   - Switch traffic back to previous ASG: in Deployment Group select prior green version -> reroute.
4. Confirm:
   - Health checks passing
   - Error rate normalizing
5. Disable auto-promotion for failing artifact.
6. Open follow-up ticket for root cause.

Exit:
- New (old) version stable 10–15 min.

---

### 8.8 EC2 Instance Unhealthy / Capacity Shortage

Checks:
1. ASG events (describe-scaling-activities).
2. CloudWatch: CPUCreditBalance (if burstable), CPUUtilization, NetworkOut throttles.
3. ELB/NLB Target health.

Mitigations:
- Manually set desired capacity +N.
- If AZ imbalance, force rebalancing.
- Rebuild from latest AMI if drift detected.
- If memory leak pattern: capture heap dump before recycle.

Exit:
- Desired vs InService matches and error / latency metrics healthy.

---

### 8.9 Database Connection Saturation

Symptoms:
- Connection pool exhausted, timeouts
- Spike in 503/500 with `db_timeout` tag

Procedure:
1. Inspect connection usage metric (`db_active_connections`).
2. Identify long-running queries (Performance Insights / pg_stat_activity).
3. Confirm application pool size vs DB capacity.
4. Check sudden surge in session creation.

Mitigations:
- Lower pool max temporarily to reduce thrash (if oversubscribed).
- Kill stuck queries (with caution).
- Enable query plan cache (if disabled).
- Scale writer if vertical scaling available (Aurora class change off-peak).
- Introduce adaptive caching (enable `SESSION_CACHE_ENABLED=true`).

Exit:
- Connection usage < 80% sustained.

---

## 9. Observability Dashboards (Suggested Panels)

1. Overview
   - Request Rate
   - Error Rate Breakdown
   - P50/P95/P99 Latency
   - Active Sessions
2. Downstream Dependencies
   - Redis latency, hit ratio
   - DB connections, slow queries
   - Kafka lag, consumer rebalance count
3. Infrastructure
   - Node CPU / Memory
   - ASG desired vs in-service
   - Network throughput
4. Tracing Hot Endpoints
   - Top N endpoints by duration
   - Slow span categories
5. Rate Limiting
   - Allowed vs Limited vs Shadow decisions
6. Feature Flags Impact
   - Flag toggles timeline vs latency

---

## 10. Access & Secrets

- Production access via SSM Session Manager (no direct SSH).
- Temporary privilege escalation via IAM role `StreamingApiProdOps`.
- Secrets managed in AWS Secrets Manager; rotation every 30d.
- Any break-glass access requires ticket + IC approval.

---

## 11. Escalation Matrix (Fictional Contacts)

| Layer | Team | Contact Method |
|-------|------|----------------|
| On-Call Primary | Streaming API | PagerDuty schedule |
| Secondary | Platform Reliability | PD escalation policy |
| Data Platform (Kafka) | Data Eng | Slack #data-oncall |
| Auth Service | Identity Team | Slack #identity-pager |
| Security | SecOps | Hotline + PD |
| Network / CDN | NetOps | Slack #network-ops |
| Database | DBRE | Slack #db-oncall |

If no acknowledgment from next tier in 10 min, escalate to Duty Manager.

---

## 12. Communication Templates

Initial Incident (Sev1):
```
[INCIDENT][Sev1][Streaming API]
Start: 2025-08-11T14:05Z
Impact: Elevated 5xx (7%), client latency P95 3.2s
User Impact: Delayed event delivery; some clients retrying
Mitigation In Progress: Rolling back to previous build
Next Update: +15m
IC: @alice  Comms: @rohan
```

Update:
```
[UPDATE][Sev1][14:25Z]
Rollback completed, 5xx trending down (0.6%), latency improving (P95 1.4s)
Investigating root cause (suspected DB connection leak)
Next Update: 14:40Z
```

Resolution:
```
[RESOLVED][Sev1]
End: 14:38Z
Total Duration: 33m
Cause: Connection pool leak in v2025.08.11-2
Mitigation: Rollback + pool saturation relief
Actions: Root cause RCA scheduled, feature flag safeguard to be added
```

Customer-Facing (Status Page):
```
We experienced elevated error rates and increased latency on the Streaming API between 14:05 UTC and 14:38 UTC. The issue has been mitigated. We are conducting a full review.
```

---

## 13. Post-Incident Review (Template)

| Field | Content |
|-------|---------|
| Incident ID | INC-<date>-<seq> |
| Severity | Sev1 / Sev2 / Sev3 |
| Start / End Time |  |
| Duration |  |
| Impact Summary |  |
| User Impact | (quantify) |
| SLO / Error Budget Consumption |  |
| Root Cause | (5 Whys) |
| Contributing Factors |  |
| What Went Well |  |
| What Went Poorly |  |
| Detection | Alert? User report? |
| Time to Detect / Acknowledge / Mitigate / Resolve |  |
| Mitigation Actions |  |
| Permanent Fix Plan |  |
| Follow-Up Tasks (Jira IDs) |  |
| Owner / Due Dates |  |
| Approved By |  |

---

## 14. Automation & Reliability Backlog (Examples)

| Item | Priority | Rationale |
|------|----------|-----------|
| Auto-rollback on 5xx > 3% for 5m post-deploy | High | Reduce MTTR |
| Adaptive rate limiting fairness algorithm | Medium | Prevent noisy neighbor |
| Kafka partition skew detection job | Medium | Reduce lag risk |
| Synthetic auth token rotation test | Low | Catch JWKS issues early |
| Chaos experiments (Redis latency injection) | Medium | Validate resilience |
| Backpressure predictive scaling | High | Prevent latency spikes |
| Circuit breaker autotune | Low | Optimize thresholds |

---

## 15. Security & Compliance Quick Reference

- TLS cert rotation scheduled via ACM; monitor expiry alert.
- Audit logs shipped to immutable S3 bucket (`s3://audit-log-streaming/`).
- Sensitive fields (PII) masked at log ingestion (Fluent Bit Lua filter).
- Credentials never stored in images; runtime fetch only.

---

## 16. Rate Limiting Policy (Simplified)

| Tier | RPS Base | Burst | Sustained Window |
|------|----------|-------|------------------|
| Free | 50 | 200 | 60s |
| Standard | 500 | 2,000 | 60s |
| Enterprise | 2,000 | 8,000 | 60s |

- 429 body contains `retry_after_ms`.
- Clients advised exponential backoff starting 250ms.

---

## 17. Disaster Recovery Considerations (Outline)

| Scenario | Strategy |
|----------|----------|
| AZ Loss | Multi-AZ ASG & Kafka replication factor 3 |
| Region Failure | Warm standby in secondary region (lag < 15m snapshot) |
| Data Corruption | Daily snapshots (S3) + Kafka retention 7d |
| Cache Failure | Degrade to DB lookups + increased latency tolerance |

RPO: <= 15 minutes  
RTO: <= 60 minutes for full regional failover

---

## 18. Quick Command Reference

```
# List pods with high restarts
kubectl get pods -l app=streaming-api --sort-by=.status.containerStatuses[0].restartCount

# Describe high-latency endpoints (top N)
grep "REQUEST_LATENCY" /var/log/app/*.log | awk '{print $NF}' | sort | uniq -c | sort -nr | head

# AWS ASG desired vs actual
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names streaming-api-prod | jq '.AutoScalingGroups[] | {Desired: .DesiredCapacity, InService: ([.Instances[] | select(.LifecycleState=="InService")] | length)}'

# Redis latency (microseconds)
redis-cli --latency

# Top GC pauses
kubectl logs <pod> | grep "GC pause" | tail
```

---

## 19. Glossary

| Term | Definition |
|------|------------|
| Backpressure | Mechanism to slow ingestion when downstream saturated |
| Error Budget | Allowable unreliability per SLO window |
| SLO | Service Level Objective (quantitative goal) |
| SLI | Measured indicator of performance/reliability |
| ISR | In-Sync Replicas (Kafka) |
| P95 | 95th percentile latency |

---

## 20. Validation Checklist (Keep Updated)

| Category | Check | Status |
|----------|-------|--------|
| Monitoring | All critical alerts tested quarterly | |
| Runbooks | Updated past 90 days | |
| Secrets | Rotation schedule current | |
| DR | Last failover test date recorded | |
| Capacity | Forecast updated | |
| Performance | Load test last executed | |

---

## 21. Document Change Control

| Date | Author | Change |
|------|--------|--------|
| 2025-08-11 | SRE Demo | Initial draft |

---

Disclaimer: This is a fictional example intended for demonstration purposes only.
