# Cloud Providers

Decision framework for choosing between AWS, DigitalOcean, Hetzner, OCI, and Vultr. Real pricing, real tradeoffs, real configs for solo devs and small teams.

---

## Table of Contents

1. [Decision Framework](#1-decision-framework)
2. [AWS Essentials for Small Teams](#2-aws-essentials-for-small-teams)
3. [DigitalOcean](#3-digitalocean)
4. [Hetzner](#4-hetzner)
5. [Oracle Cloud (OCI)](#5-oracle-cloud-oci)
6. [Vultr](#6-vultr)
7. [Provider Comparison Tables](#7-provider-comparison-tables)
8. [Cost Estimation Templates](#8-cost-estimation-templates)
9. [Migration Between Providers](#9-migration-between-providers)

---

## 1. Decision Framework

### 1.1 Quick Decision Tree

```
Is it a static site or JAMstack?
  → Yes → Cloudflare Pages / Vercel (free)
  → No ↓

Budget under $20/month?
  → Yes → Hetzner CX22 ($4) or OCI Always Free
  → No ↓

Need managed services (RDS, SQS, Lambda)?
  → Yes → AWS or DigitalOcean
  → No ↓

Need best price/performance for raw compute?
  → Yes → Hetzner
  → No ↓

Need US/global presence with simple UX?
  → Yes → DigitalOcean or Vultr
  → No ↓

Need compliance (SOC2, PCI, HIPAA)?
  → Yes → AWS (or GCP/Azure)
  → No → Hetzner or DigitalOcean
```

### 1.2 When to Use Each Provider

| Provider | Best For | Avoid When |
|---|---|---|
| **Hetzner** | Best price/perf, EU-based, simple VPS | Need US presence, many managed services, compliance certs |
| **DigitalOcean** | Simple managed infra, good UX, US/EU/Asia | Need advanced AWS services, enterprise compliance |
| **AWS** | Enterprise, compliance, 200+ services, global edge | Solo dev on budget, simple apps, learning infra |
| **OCI** | Free tier abuse, ARM VMs, cost savings | Need wide ecosystem, community support, good docs |
| **Vultr** | Competitive VPS, bare metal, many locations | Need managed DB quality of DO, need AWS ecosystem |

### 1.3 Decision by Project Type

**Laravel app (Bruno's typical project):**
- Default: Hetzner CX22 ($4/mo) + Cloudflare Free + Caddy
- With managed DB: DO Droplet ($6) + DO Managed MySQL ($15) = $21/mo
- Production SaaS: DO Droplet ($24) + DO Managed DB ($30) + DO Spaces ($5) = ~$59/mo

**Go API service:**
- Default: Hetzner CX22 ($4/mo) — Go is memory-efficient, 2GB is plenty
- High traffic: Hetzner CX32 ($7/mo) — 3 vCPU, 4GB RAM
- Multiple services: Hetzner dedicated (AX42, $47/mo) with Docker

**BHEN-style platform (Mac Mini + Tailscale):**
- Already owns hardware → $0/mo hosting
- Cloudflare Tunnel for public access → $0/mo
- Backup target: Hetzner Storage Box (1TB, $4/mo) or Backblaze B2

---

## 2. AWS Essentials for Small Teams

### 2.1 What's Actually Free (Free Tier Details)

**12-month free tier (new accounts only):**

| Service | Free Allowance | After Free Tier |
|---|---|---|
| EC2 t2.micro/t3.micro | 750 hrs/month (1 instance 24/7) | ~$8.50/mo (t3.micro) |
| RDS db.t2.micro/t3.micro | 750 hrs/month, 20GB storage | ~$13/mo (t3.micro, single-AZ) |
| S3 | 5GB storage, 20K GET, 2K PUT | $0.023/GB/mo |
| CloudFront | 1TB transfer, 10M requests | $0.085/GB (first 10TB) |
| SES | 62K emails/month (from EC2) | $0.10/1K emails |

**Always free (never expires):**

| Service | Free Allowance |
|---|---|
| Lambda | 1M requests, 400K GB-seconds/mo |
| DynamoDB | 25GB, 25 WCU, 25 RCU |
| SNS | 1M publishes |
| SQS | 1M requests |
| CloudWatch | 10 custom metrics, 10 alarms |
| API Gateway | 1M REST API calls/mo (12 months) |

### 2.2 EC2 Instance Selection

**For small teams running Laravel/Go:**

| Instance | vCPU | RAM | Price (us-east-1) | Use Case |
|---|---|---|---|---|
| t3.micro | 2 | 1GB | $7.59/mo | Dev/staging |
| t3.small | 2 | 2GB | $15.18/mo | Small Laravel app |
| t3.medium | 2 | 4GB | $30.37/mo | Production Laravel |
| t3.large | 2 | 8GB | $60.74/mo | Laravel + Redis + workers |
| c6g.medium (ARM) | 1 | 2GB | $24.82/mo | Go API (compute-bound) |
| r6g.medium (ARM) | 1 | 8GB | $36.50/mo | Memory-heavy workloads |

**Spot instances — save 60-90%:**

```bash
# Check spot pricing
aws ec2 describe-spot-price-history \
  --instance-types t3.medium \
  --product-descriptions "Linux/UNIX" \
  --start-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --region us-east-1
# Typical: t3.medium spot = $0.0104/hr (~$7.50/mo vs $30.37 on-demand)
```

```
# WRONG — using on-demand for stateless workers
# Paying $30/mo for a batch processing instance

# CORRECT — use spot for fault-tolerant workloads
# Same instance for ~$7.50/mo, design for interruption
```

**Reserved Instances / Savings Plans:**
- 1-year no-upfront: ~30% discount
- 1-year all-upfront: ~40% discount
- 3-year all-upfront: ~60% discount
- Only commit after 3+ months of stable usage

### 2.3 RDS (Managed Database)

```
# WRONG — running MySQL/PostgreSQL on EC2 yourself
# You'll handle: backups, patching, replication, failover, monitoring
# At 3 AM when it goes down, you'll wish you hadn't

# CORRECT for small teams — use RDS
# Trade $15-30/mo extra for: automated backups, patching, monitoring, replicas
```

| RDS Instance | vCPU | RAM | Price (single-AZ) | Use Case |
|---|---|---|---|---|
| db.t3.micro | 2 | 1GB | $12.41/mo | Dev/tiny app |
| db.t3.small | 2 | 2GB | $24.82/mo | Small production |
| db.t3.medium | 2 | 4GB | $49.64/mo | Production SaaS |
| db.t4g.medium (ARM) | 2 | 4GB | $42.05/mo | Better price/perf |

**Cost-saving tips:**
- Single-AZ is fine for most small apps (save ~45% vs multi-AZ)
- Use db.t4g (Graviton/ARM) — 10-15% cheaper, same or better performance
- Storage: 20GB gp3 is ~$1.60/mo — start small
- Automated backups: free up to DB size (7-day retention default)

### 2.4 S3 (Object Storage)

```bash
# Create a bucket for user uploads
aws s3 mb s3://myapp-uploads-prod --region us-east-1

# Lifecycle policy — move old files to cheaper storage
aws s3api put-bucket-lifecycle-configuration \
  --bucket myapp-uploads-prod \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "MoveToIA",
      "Status": "Enabled",
      "Transitions": [{
        "Days": 90,
        "StorageClass": "STANDARD_IA"
      }],
      "Filter": {"Prefix": ""}
    }]
  }'
```

**S3 pricing (us-east-1):**

| Storage Class | Price/GB/mo | Retrieval | Use Case |
|---|---|---|---|
| Standard | $0.023 | Free | Frequently accessed |
| Standard-IA | $0.0125 | $0.01/GB | Monthly access |
| Glacier Instant | $0.004 | $0.03/GB | Quarterly access |
| Glacier Deep | $0.00099 | $0.02/GB, 12hr delay | Annual audit/compliance |

### 2.5 AWS Cost Pitfalls

**These will surprise you on your first bill:**

| Trap | What Happens | How to Avoid |
|---|---|---|
| **Data transfer out** | $0.09/GB after first 100GB/mo | Use CloudFront ($0.085/GB, cheaper at scale) |
| **NAT Gateway** | $0.045/hr ($32/mo) + $0.045/GB | Use VPC endpoints for S3/DynamoDB; avoid NAT for small apps |
| **EBS snapshots** | $0.05/GB/mo — accumulates silently | Set lifecycle policies, delete old snapshots |
| **Elastic IP (unattached)** | $0.005/hr ($3.65/mo) per idle EIP | Release unused EIPs immediately |
| **RDS multi-AZ** | 2x the single-AZ price | Use single-AZ for non-critical apps |
| **CloudWatch Logs** | $0.50/GB ingestion + $0.03/GB storage | Set retention policies (7-30 days) |
| **Load Balancer** | ALB minimum $16.20/mo + LCU charges | Use Caddy/Nginx on the instance for small apps |
| **Secrets Manager** | $0.40/secret/month | Use SSM Parameter Store (free for standard) |

```bash
# Check your current month cost
aws ce get-cost-and-usage \
  --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE

# Set a billing alarm (ALWAYS do this)
aws cloudwatch put-metric-alarm \
  --alarm-name "MonthlyBillingAlarm" \
  --alarm-description "Alert when bill exceeds $50" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=Currency,Value=USD \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:billing-alerts
```

### 2.6 When AWS Is Overkill

AWS is overkill when:
- Solo dev running 1-3 apps → Hetzner VPS is 5-10x cheaper
- No compliance requirements → simpler providers are fine
- Don't need 200+ managed services → DigitalOcean covers 90% of needs
- Budget under $100/month → AWS overhead costs eat your budget
- Don't have time to learn IAM, VPCs, security groups → steeper learning curve

**Concrete example — Laravel SaaS:**

| Component | AWS Cost | Hetzner + DO Cost |
|---|---|---|
| Compute | EC2 t3.small: $15/mo | Hetzner CX22: $4/mo |
| Database | RDS t3.micro: $12/mo | DO Managed MySQL: $15/mo |
| Storage | S3: ~$2/mo | DO Spaces: $5/mo (250GB) |
| CDN | CloudFront: ~$5/mo | Cloudflare: $0 (free) |
| Email | SES: ~$1/mo | Resend: $0 (free tier) |
| SSL | ACM: $0 | Caddy: $0 (auto Let's Encrypt) |
| Load Balancer | ALB: $16/mo | Caddy: $0 (built-in) |
| **Total** | **~$51/mo** | **~$24/mo** |

---

## 3. DigitalOcean

### 3.1 Droplets (VPS)

| Plan | vCPU | RAM | Storage | Transfer | Price |
|---|---|---|---|---|---|
| Basic $6 | 1 | 1GB | 25GB SSD | 1TB | $6/mo |
| Basic $12 | 1 | 2GB | 50GB SSD | 2TB | $12/mo |
| Basic $24 | 2 | 4GB | 80GB SSD | 4TB | $24/mo |
| Basic $48 | 4 | 8GB | 160GB SSD | 5TB | $48/mo |
| Premium $12 | 1 | 2GB | 50GB NVMe | 2TB | $12/mo |
| Premium $24 | 2 | 4GB | 80GB NVMe | 4TB | $24/mo |
| CPU-Optimized $42 | 2 | 4GB | 25GB NVMe | 4TB | $42/mo |

**Premium AMD droplets** have NVMe storage — 5-10x faster disk I/O. Worth it for databases.

### 3.2 Managed Databases

| Engine | Plan | vCPU | RAM | Storage | Price |
|---|---|---|---|---|---|
| PostgreSQL/MySQL | Basic | 1 | 1GB | 10GB | $15/mo |
| PostgreSQL/MySQL | Basic | 2 | 4GB | 38GB | $60/mo |
| Redis | Basic | 1 | 1GB | — | $15/mo |

**Includes:** daily backups (7-day retention), automatic failover (HA plans), end-to-end encryption, maintenance windows.

```
# WRONG — connecting to managed DB over public internet
DATABASE_URL=postgres://user:pass@db-public-ip:5432/mydb

# CORRECT — use VPC (private network)
DATABASE_URL=postgres://user:pass@private-db-hostname:25060/mydb
# DO managed DBs use port 25060 by default, not 5432
```

### 3.3 Spaces (S3-Compatible Object Storage)

- $5/month for 250GB storage + 1TB outbound transfer
- S3-compatible API (works with any S3 SDK)
- Built-in CDN (Spaces CDN) — served from edge locations

```bash
# Configure with AWS CLI (S3-compatible)
aws configure --profile digitalocean
# Access Key: your-spaces-key
# Secret Key: your-spaces-secret
# Region: nyc3

# Upload a file
aws s3 cp backup.tar.gz s3://my-bucket/backups/ \
  --endpoint-url https://nyc3.digitaloceanspaces.com \
  --profile digitalocean
```

**For Laravel:**

```php
// config/filesystems.php — use S3 driver with DO Spaces
'do_spaces' => [
    'driver' => 's3',
    'key' => env('DO_SPACES_KEY'),
    'secret' => env('DO_SPACES_SECRET'),
    'region' => env('DO_SPACES_REGION', 'nyc3'),
    'bucket' => env('DO_SPACES_BUCKET'),
    'endpoint' => env('DO_SPACES_ENDPOINT', 'https://nyc3.digitaloceanspaces.com'),
    'url' => env('DO_SPACES_CDN_URL'),  // https://my-bucket.nyc3.cdn.digitaloceanspaces.com
],
```

### 3.4 App Platform

PaaS similar to Heroku — deploy from Git:

| Plan | vCPU | RAM | Price |
|---|---|---|---|
| Basic | 1 | 512MB | $5/mo |
| Professional | 1 | 1GB | $12/mo |
| Professional | 2 | 4GB | $44/mo |

Good for: quick deploys, no infra management. Bad for: cost at scale, limited control.

### 3.5 When to Choose DO Over AWS

Choose DigitalOcean when:
- You want managed services without AWS complexity
- Budget is $20-200/month
- Team is 1-5 engineers
- US/EU/Asia presence is needed (13 regions)
- Managed Kubernetes is appealing (DO Kubernetes starts at $12/mo for control plane)
- Simple, predictable pricing matters more than 200+ services

---

## 4. Hetzner

### 4.1 Cloud VPS (Best Price/Performance)

| Plan | vCPU | RAM | Storage | Transfer | Price |
|---|---|---|---|---|---|
| CX22 | 2 | 4GB | 40GB | 20TB | EUR 3.79/mo (~$4) |
| CX32 | 4 | 8GB | 80GB | 20TB | EUR 6.59/mo (~$7) |
| CX42 | 8 | 16GB | 160GB | 20TB | EUR 14.49/mo (~$16) |
| CX52 | 16 | 32GB | 320GB | 20TB | EUR 28.49/mo (~$31) |
| CAX11 (ARM) | 2 | 4GB | 40GB | 20TB | EUR 3.79/mo (~$4) |
| CAX21 (ARM) | 4 | 8GB | 80GB | 20TB | EUR 5.99/mo (~$7) |
| CAX31 (ARM) | 8 | 16GB | 160GB | 20TB | EUR 8.99/mo (~$10) |

**Key advantages:**
- 20TB transfer included (vs 1-5TB on DO/Vultr)
- ARM instances (CAX) are same price but often faster for Go/compiled languages
- All prices include VAT for EU customers
- Backups: +20% of server price

### 4.2 Dedicated Servers

For when VPS isn't enough — real hardware, no noisy neighbors:

| Model | CPU | RAM | Storage | Transfer | Price |
|---|---|---|---|---|---|
| AX42 | Ryzen 5 3600 | 64GB | 2x512GB NVMe | 20TB | EUR 44/mo (~$48) |
| AX52 | Ryzen 7 3700X | 64GB | 2x1TB NVMe | 20TB | EUR 56/mo (~$61) |
| AX102 | Ryzen 9 5950X | 128GB | 2x2TB NVMe | 20TB | EUR 86/mo (~$94) |

**Use dedicated when:**
- Need consistent performance (no VM overhead)
- Running multiple Docker containers on one machine
- Database-heavy workloads that need guaranteed I/O
- Cost-effective at scale (AX42 = ~5 DO droplets worth of power)

### 4.3 Storage Boxes (Backup Target)

| Plan | Storage | Price |
|---|---|---|
| BX11 | 1TB | EUR 3.81/mo (~$4) |
| BX21 | 5TB | EUR 9.52/mo (~$10) |
| BX31 | 10TB | EUR 16.52/mo (~$18) |

Protocols: SFTP, SCP, rsync, Samba/CIFS, BorgBackup, Restic.

```bash
# Automated backup to Hetzner Storage Box with restic
export RESTIC_REPOSITORY="sftp:u123456@u123456.your-storagebox.de:/backups/myapp"
export RESTIC_PASSWORD="your-encryption-password"

# Initialize repository (once)
restic init

# Daily backup script
restic backup /var/www/myapp /var/backups/mysql
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
```

### 4.4 Hetzner Limitations

- **Regions:** Only Germany (Falkenstein, Nuremberg) and Finland (Helsinki). US datacenter (Ashburn, VA) available for Cloud.
- **Managed services:** No managed databases, no managed Kubernetes (they have it but it's basic), no managed Redis
- **Support:** German company, support quality varies. No phone support on basic plans.
- **DDoS protection:** Basic L3/L4 only. No WAF. Use Cloudflare in front.
- **Object storage:** Available but newer, not as mature as S3/Spaces

### 4.5 Hetzner vs DigitalOcean vs AWS (Same Specs)

**2 vCPU, 4GB RAM, 80GB SSD:**

| Provider | Instance | Price | Transfer | Notes |
|---|---|---|---|---|
| Hetzner | CX32 | $7/mo | 20TB | Best value |
| DigitalOcean | Basic $24 | $24/mo | 4TB | Managed services, better UX |
| AWS | t3.medium | $30/mo | 100GB free then $0.09/GB | Most services, most complex |
| Vultr | Cloud Compute | $24/mo | 4TB | Middle ground |

Hetzner is 3-4x cheaper for raw compute. You pay with fewer managed services and fewer regions.

---

## 5. Oracle Cloud (OCI)

### 5.1 Always Free Tier (Genuinely Generous)

OCI's Always Free tier is the best in the industry — **never expires:**

| Resource | Free Allowance |
|---|---|
| AMD VM (VM.Standard.E2.1.Micro) | 2 instances, 1/8 OCPU, 1GB RAM each |
| ARM VM (VM.Standard.A1.Flex) | Up to 4 OCPU, 24GB RAM total |
| Block Storage | 200GB total |
| Object Storage | 10GB |
| Outbound Data Transfer | 10TB/mo |
| Load Balancer | 1 flexible LB |
| Autonomous Database | 2 databases, 20GB each |
| Monitoring | 500M ingestion datapoints |

**The ARM VM is the gem:** 4 OCPU + 24GB RAM for free. That's more powerful than a $48 DO droplet.

### 5.2 Setting Up the Free ARM VM

```bash
# Install OCI CLI
bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"

# Create a VM (Ampere A1 ARM — 4 OCPU, 24GB RAM)
oci compute instance launch \
  --availability-domain "AD-1" \
  --compartment-id ocid1.compartment.oc1..xxx \
  --shape "VM.Standard.A1.Flex" \
  --shape-config '{"ocpus": 4, "memoryInGBs": 24}' \
  --image-id ocid1.image.oc1..xxx \
  --subnet-id ocid1.subnet.oc1..xxx \
  --ssh-authorized-keys-file ~/.ssh/id_ed25519.pub \
  --assign-public-ip true
```

### 5.3 OCI Gotchas

- **Availability:** Free ARM instances are often out of capacity. You may need to retry for days. Use scripts to auto-retry.
- **Account termination:** Oracle has been known to terminate idle free-tier accounts. Keep some activity.
- **Documentation:** Significantly worse than AWS/DO. Expect to struggle.
- **Community:** Small community. Fewer tutorials, fewer Stack Overflow answers.
- **Egress pricing:** 10TB/mo free is amazing, but beyond that it's $0.0085/GB (cheaper than AWS).

```bash
# Script to retry creating ARM instance (capacity issue workaround)
#!/bin/bash
while true; do
  oci compute instance launch \
    --compartment-id "$COMPARTMENT_ID" \
    --shape "VM.Standard.A1.Flex" \
    --shape-config '{"ocpus": 4, "memoryInGBs": 24}' \
    ... 2>&1 | tee /tmp/oci-launch.log

  if grep -q "InternalError\|Out of host capacity" /tmp/oci-launch.log; then
    echo "$(date) — No capacity, retrying in 60s..."
    sleep 60
  else
    echo "$(date) — Instance launched!"
    break
  fi
done
```

### 5.4 When to Use OCI

- **Dev/staging environments** — free ARM VM is perfect
- **Personal projects** — 24GB RAM free is unbeatable
- **CI/CD runners** — self-hosted GitHub Actions runners on free tier
- **Database** — free Autonomous DB for small apps
- **NOT for production SaaS** — reliability concerns, poor support, risk of account issues

---

## 6. Vultr

### 6.1 Cloud Compute

| Plan | vCPU | RAM | Storage | Transfer | Price |
|---|---|---|---|---|---|
| Regular | 1 | 1GB | 25GB SSD | 1TB | $5/mo |
| Regular | 1 | 2GB | 50GB SSD | 2TB | $10/mo |
| Regular | 2 | 4GB | 80GB SSD | 3TB | $20/mo |
| Regular | 4 | 8GB | 160GB SSD | 4TB | $40/mo |
| High Frequency | 1 | 1GB | 32GB NVMe | 1TB | $6/mo |
| High Frequency | 2 | 4GB | 128GB NVMe | 3TB | $24/mo |

### 6.2 Vultr Advantages

- **32 locations worldwide** — more than DO or Hetzner
- **Bare metal** from $120/mo — dedicated hardware
- **Kubernetes (VKE)** — free control plane (pay only for workers)
- **Object storage** — S3-compatible, $5/mo for 250GB
- **Marketplace** — one-click apps (WordPress, Docker, etc.)
- **Hourly billing** — all plans

### 6.3 Vultr vs DigitalOcean

Roughly equivalent in pricing and features. Choose Vultr when:
- Need a specific geographic location Vultr has and DO doesn't
- Want bare metal options
- Slightly cheaper at some tiers

Choose DO when:
- Need managed databases (DO's managed DBs are more mature)
- Better documentation and community
- App Platform (PaaS)

---

## 7. Provider Comparison Tables

### 7.1 Entry-Level VPS (~$5/mo)

| Provider | Instance | vCPU | RAM | Storage | Transfer | Price |
|---|---|---|---|---|---|---|
| **Hetzner** | CX22 | 2 | 4GB | 40GB | 20TB | $4/mo |
| **OCI** | A1.Flex (free) | 4 | 24GB | 200GB | 10TB | $0/mo |
| **Vultr** | Regular | 1 | 1GB | 25GB | 1TB | $5/mo |
| **DigitalOcean** | Basic | 1 | 1GB | 25GB | 1TB | $6/mo |
| **AWS** | t3.micro | 2 | 1GB | 8GB EBS | 100GB | ~$9/mo |

Winner: **OCI** (free) if you can get capacity. **Hetzner** for reliability.

### 7.2 Mid-Range VPS (~$20-30/mo)

| Provider | Instance | vCPU | RAM | Storage | Transfer | Price |
|---|---|---|---|---|---|---|
| **Hetzner** | CX42 | 8 | 16GB | 160GB | 20TB | $16/mo |
| **Vultr** | Regular | 2 | 4GB | 80GB | 3TB | $20/mo |
| **DigitalOcean** | Basic | 2 | 4GB | 80GB | 4TB | $24/mo |
| **AWS** | t3.medium | 2 | 4GB | 80GB EBS | pay/GB | ~$35/mo |

Winner: **Hetzner** by a wide margin. 4x the resources for the same or lower price.

### 7.3 Feature Comparison

| Feature | AWS | DO | Hetzner | OCI | Vultr |
|---|---|---|---|---|---|
| Managed PostgreSQL | Yes | Yes | No | Yes (Autonomous) | No |
| Managed MySQL | Yes | Yes | No | Yes (Autonomous) | No |
| Managed Redis | Yes | Yes | No | No | No |
| Object Storage (S3) | Yes | Yes (Spaces) | Yes | Yes | Yes |
| CDN | CloudFront | Spaces CDN | No | No | No |
| Kubernetes | EKS ($72/mo) | DOKS ($12/mo) | Basic | OKE (free CP) | VKE (free CP) |
| Load Balancer | ALB ($16/mo) | $12/mo | $6/mo | Free (1) | $10/mo |
| DNS Hosting | Route 53 | Free | Free | Free | Free |
| DDoS Protection | Shield | Basic | Basic L3/L4 | Basic | Basic |
| Regions | 30+ | 14 | 5 | 40+ | 32 |
| API Quality | Excellent | Excellent | Good | Poor | Good |
| Terraform Provider | Excellent | Excellent | Good | Fair | Good |
| Support Quality | Paid tiers | Good | Basic | Poor | Basic |

---

## 8. Cost Estimation Templates

### 8.1 MVP ($0-20/month)

**Stack:** Laravel or Go + SQLite/PostgreSQL + Cloudflare

```
Option A: Hetzner CX22 (everything on one server)
├── VPS:           $4/mo  (2 vCPU, 4GB RAM, 40GB)
├── Cloudflare:    $0     (free tier)
├── SSL:           $0     (Caddy auto-HTTPS)
├── Backup:        $1/mo  (Hetzner 20% of server)
├── Domain:        $1/mo  (~$12/year)
├── Email:         $0     (Resend free tier, 3K/mo)
└── TOTAL:         ~$6/mo

Option B: Oracle Cloud Free Tier
├── ARM VM:        $0     (4 OCPU, 24GB RAM)
├── Block Storage: $0     (200GB)
├── Cloudflare:    $0
├── Domain:        $1/mo
└── TOTAL:         ~$1/mo (just the domain)

Option C: Cloudflare Pages + Supabase (if static + API)
├── Hosting:       $0     (Cloudflare Pages)
├── Database:      $0     (Supabase free: 500MB)
├── Auth:          $0     (Supabase free: 50K MAU)
├── Storage:       $0     (Supabase free: 1GB)
└── TOTAL:         $0/mo
```

### 8.2 SaaS Validated ($50-200/month)

**Stack:** Laravel + PostgreSQL + Redis + S3 + Queue Workers

```
Option A: DigitalOcean (managed services)
├── Droplet:       $24/mo  (2 vCPU, 4GB, for app + workers)
├── Managed DB:    $30/mo  (PostgreSQL, 2 vCPU, 4GB)
├── Managed Redis: $15/mo  (1GB)
├── Spaces:        $5/mo   (250GB + CDN)
├── Cloudflare:    $20/mo  (Pro — WAF, analytics)
├── Email:         $20/mo  (Resend Pro, 50K/mo)
├── Backups:       $5/mo   (DO automated + Spaces)
├── Monitoring:    $0      (DO built-in + free Uptime Kuma)
└── TOTAL:         ~$119/mo

Option B: Hetzner + self-managed (cheaper, more work)
├── VPS:           $7/mo   (CX32: 4 vCPU, 8GB)
├── PostgreSQL:    $0      (self-hosted on VPS)
├── Redis:         $0      (self-hosted on VPS)
├── Storage Box:   $4/mo   (1TB for backups)
├── Spaces/S3:     $5/mo   (DO Spaces for uploads)
├── Cloudflare:    $20/mo  (Pro)
├── Email:         $20/mo  (Resend Pro)
└── TOTAL:         ~$56/mo
```

### 8.3 Growing App ($200-1000/month)

**Stack:** Laravel + PostgreSQL HA + Redis Cluster + CDN + Monitoring

```
Option A: DigitalOcean
├── App Droplets:  $96/mo  (2x $48: 4 vCPU, 8GB)
├── Managed DB HA: $90/mo  (PostgreSQL standby node)
├── Managed Redis: $30/mo  (2GB, HA)
├── Load Balancer: $12/mo
├── Spaces:        $5/mo
├── Cloudflare:    $200/mo (Business — advanced WAF, SLA)
├── Email:         $20/mo
├── Monitoring:    $40/mo  (Datadog or similar)
├── Backups:       $20/mo
└── TOTAL:         ~$513/mo

Option B: AWS
├── EC2:           $121/mo (2x t3.large reserved 1yr)
├── RDS:           $150/mo (db.t3.large multi-AZ)
├── ElastiCache:   $50/mo  (cache.t3.small)
├── ALB:           $20/mo
├── S3:            $5/mo
├── CloudFront:    $20/mo
├── SES:           $10/mo
├── CloudWatch:    $15/mo
├── Data Transfer: $30/mo  (estimate)
├── NAT Gateway:   $32/mo  (if using private subnets)
└── TOTAL:         ~$453/mo
```

### 8.4 Scale ($1000+/month)

At this budget, AWS/GCP starts making sense due to:
- Managed services reduce operations burden
- Reserved instances / savings plans reduce costs
- Compliance certifications included
- Auto-scaling for variable traffic
- Multi-region capabilities

```
AWS estimated for a production SaaS (1000+ users, moderate traffic):
├── EC2 (3x c6g.xlarge, reserved): $250/mo
├── RDS (db.r6g.large, multi-AZ):  $350/mo
├── ElastiCache (2-node cluster):   $120/mo
├── ALB + WAF:                      $50/mo
├── S3 (500GB + lifecycle):         $15/mo
├── CloudFront (2TB/mo):            $170/mo
├── SES (100K emails):              $10/mo
├── CloudWatch + X-Ray:             $50/mo
├── Data Transfer:                  $100/mo
├── Secrets Manager + SSM:          $10/mo
├── Route 53:                       $5/mo
└── TOTAL:                          ~$1,130/mo
```

---

## 9. Migration Between Providers

### 9.1 What to Plan

**Before migrating:**

1. **DNS TTL:** Lower TTL to 300s (5 min) 48 hours before migration
2. **Data inventory:** Database size, file storage size, number of domains
3. **Downtime window:** Calculate acceptable downtime (minutes vs hours)
4. **Rollback plan:** Keep old server running for 48-72 hours after migration
5. **Dependencies:** External services pointing to old IP (webhooks, APIs, email)

### 9.2 Migration Checklist

```
Pre-migration:
  [ ] Lower DNS TTL to 300 seconds (48h before)
  [ ] Document all server configs (reverse proxy, cron, env vars)
  [ ] Test backup restore on new server
  [ ] Set up new server completely (without traffic)
  [ ] Run smoke tests on new server (curl, health checks)

Migration:
  [ ] Put app in maintenance mode
  [ ] Take final database dump
  [ ] Sync file storage (rsync)
  [ ] Restore database on new server
  [ ] Update DNS to point to new IP
  [ ] Verify new server is serving traffic
  [ ] Remove maintenance mode

Post-migration:
  [ ] Monitor error rates for 24 hours
  [ ] Check all cron jobs are running
  [ ] Verify email sending works
  [ ] Test file uploads
  [ ] Keep old server for 72 hours (rollback)
  [ ] After 72 hours: destroy old server
  [ ] Restore DNS TTL to 3600 or higher
```

### 9.3 Database Migration

```bash
# PostgreSQL — dump and restore
# On old server:
pg_dump -Fc -h localhost -U myuser mydb > mydb.dump

# Transfer to new server:
rsync -avz --progress mydb.dump deploy@new-server:/tmp/

# On new server:
pg_restore -h localhost -U myuser -d mydb /tmp/mydb.dump

# MySQL — dump and restore
# On old server:
mysqldump -u root -p --single-transaction --routines mydb > mydb.sql

# Transfer and restore:
rsync -avz --progress mydb.sql deploy@new-server:/tmp/
mysql -u root -p mydb < /tmp/mydb.sql
```

### 9.4 File Storage Migration

```bash
# rsync for file storage (runs incremental — safe to run multiple times)
rsync -avz --progress \
  deploy@old-server:/var/www/myapp/storage/app/public/ \
  /var/www/myapp/storage/app/public/

# S3/Spaces migration (between S3-compatible providers)
# Install rclone
curl https://rclone.org/install.sh | sudo bash

# Configure source and destination in rclone.conf
rclone sync do-spaces:my-bucket hetzner-s3:my-bucket \
  --progress \
  --transfers 16 \
  --checkers 16
```

### 9.5 Zero-Downtime DNS Migration with Cloudflare

```
1. Old server: 1.2.3.4 (current production)
2. New server: 5.6.7.8 (fully set up, tested)

Steps:
a) In Cloudflare, A record points to 1.2.3.4 (proxied, orange cloud)
b) Put old server in read-only / maintenance mode
c) Final data sync (database + files)
d) Update Cloudflare A record to 5.6.7.8
e) Since Cloudflare proxies traffic, the IP change is instant (no DNS propagation)
f) Verify new server, remove maintenance mode
g) Downtime = time for step b + c + d (minutes, not hours)
```

This is one of the biggest advantages of using Cloudflare proxy — DNS changes are instant because users connect to Cloudflare's IP, not yours.
