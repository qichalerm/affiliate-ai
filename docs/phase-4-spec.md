# Phase 4 Spec — Performance ML

> **Goal**: System self-tunes. Predicts which content will hit before producing. Auto-rebalances budget across channels.
> **Trigger to build**: Phase 3 stable for ≥8 weeks, ≥60 days of multi-platform data, ≥฿200k/mo revenue.
> **Estimated build effort**: 1-2 chat sessions, ~20-25 new files.
> **New monthly cost when running**: +$30 (~$250 total).

---

## Layer introduced

**Layer 10** — Performance Intelligence Loop

```
[Posted Content]
    ↓
[Analytics Collection] (every 1-6h)
    ↓
[Performance Scoring] (percentile within cohort)
    ↓
[Pattern Mining] (LLM-assisted)
    ↓
[ML Predictor] (LightGBM)
    ↓
[Auto-Rebalance] (budget shift across channels)
    ↓
[Pre-Publish Filter] (skip predicted flops)
    ↓
[(loop)]
```

Plus **Layer 4** closure: Optimization Loop = Layer 10's outputs feed back into Phase 1-3 generators.

---

## Why wait until Phase 4 for ML

ML on small data is worse than heuristics. Need:
- ≥30 posts per platform per cohort
- ≥1000 impressions per A/B variant
- ≥60 days of seasonality signal
- ≥100 affiliate conversions for attribution

Phase 4 starts when these thresholds hit.

---

## Files to create

### Analytics collection

```
src/analytics/
├── collector.ts                    # main orchestrator
├── sources/
│   ├── tiktok-insights.ts          # TikTok Business Insights API
│   ├── meta-insights.ts            # FB + IG Insights API
│   ├── youtube-analytics.ts        # YT Analytics API
│   ├── pinterest-insights.ts       # Pinterest Analytics API
│   ├── twitter-insights.ts         # X API analytics
│   ├── google-search-console.ts    # GSC API for blog
│   ├── cloudflare-analytics.ts     # CF Web Analytics
│   ├── shopee-affiliate.ts         # affiliate API for conversions
│   └── bitly-clicks.ts             # short link analytics
├── normalizer.ts                   # all sources → unified Metric type
└── ingestor.ts                     # write to time-series tables
```

### Attribution

```
src/analytics/attribution/
├── multi-touch.ts                  # first-click 30% + last-click 50% + assist 20%
├── cookie-window.ts                # 7-day cookie attribution
├── cross-platform.ts               # detect TikTok→Google→Shopee paths
└── revenue-allocator.ts            # split revenue across touchpoints
```

### Scoring

```
src/analytics/
├── content-score.ts                # 0-100 percentile within cohort
├── cohort-resolver.ts              # group similar content (niche × format × time)
└── ranking.ts                      # weekly winners + losers list
```

### ML

```
src/ml/
├── features.ts                     # extract features from posts
├── predictor.ts                    # LightGBM inference
├── training.ts                     # retrain every 2 weeks
├── models/
│   ├── content-success.lgbm        # binary classifier (hit / miss)
│   ├── reach-regressor.lgbm        # predict view count
│   └── cvr-regressor.lgbm          # predict conversion rate
├── feature-store.ts                # cache features in DB for retraining
└── evaluator.ts                    # backtest, compute MAE/precision
```

**ML stack**:
- LightGBM (via `lightgbm-node` or call Python via subprocess)
- Or: train in Python (Jupyter), serve via ONNX in Node
- Features: ~30 (content kind, niche, hour, dow, length, brand, price tier, ...)
- Retrain cadence: weekly first month, then bi-weekly

### A/B framework

```
src/ab/
├── framework.ts                    # variant assignment + significance testing
├── variants.ts                     # define variant types (hook, length, hashtag)
├── stats.ts                        # frequentist (z-test) + Bayesian
└── runner.ts                       # auto-promote winner after significance
```

### Auto-rebalance

```
src/intelligence/
├── auto-rebalance.ts               # weekly: shift % allocation across channels
├── kill-switch.ts                  # detect shadowban → pause account
└── exploration-budget.ts           # 80/20 exploit/explore allocation
```

### Schema additions

```sql
CREATE TABLE post_metrics_timeseries (
  id BIGSERIAL PRIMARY KEY,
  published_post_id INTEGER REFERENCES published_posts(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL,
  reach INTEGER,
  impressions INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  clicks INTEGER,
  watch_time_seconds REAL,
  -- Sparse: only set what platform reports
  PRIMARY KEY (id),
  UNIQUE (published_post_id, captured_at)
);

CREATE INDEX post_metrics_post_time_idx ON post_metrics_timeseries (published_post_id, captured_at);

CREATE TABLE attribution_paths (
  id BIGSERIAL PRIMARY KEY,
  conversion_id INTEGER REFERENCES conversions(id) ON DELETE CASCADE,
  touchpoint_order INTEGER,
  channel VARCHAR(32),
  affiliate_link_id INTEGER REFERENCES affiliate_links(id),
  weight REAL,                      -- e.g. 0.3 for first, 0.5 for last
  occurred_at TIMESTAMPTZ
);

CREATE TABLE ab_tests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  hypothesis TEXT,
  variant_a JSONB,
  variant_b JSONB,
  metric_to_optimize VARCHAR(64),
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  winner VARCHAR(8),                -- 'a' | 'b' | 'inconclusive'
  significance_p REAL
);

CREATE TABLE ab_assignments (
  id BIGSERIAL PRIMARY KEY,
  ab_test_id INTEGER REFERENCES ab_tests(id),
  published_post_id INTEGER REFERENCES published_posts(id),
  variant CHAR(1)
);

CREATE TABLE ml_predictions (
  id BIGSERIAL PRIMARY KEY,
  subject_kind VARCHAR(32),         -- 'content_page' | 'planned_post'
  subject_id INTEGER,
  model VARCHAR(64),
  prediction_json JSONB,
  predicted_at TIMESTAMPTZ DEFAULT now(),
  actual_outcome_json JSONB,        -- filled in after observation
  evaluated_at TIMESTAMPTZ
);
```

### Scripts

```
src/scripts/
├── ml-train.ts                     # one-shot retrain
├── ml-evaluate.ts                  # backtest model
├── ab-status.ts                    # see running tests
└── attribution-report.ts           # multi-touch revenue breakdown
```

---

## Decision logic

### Pre-publish filter (highest impact)

```typescript
// Before generating + posting:
const prediction = await predictor.predict({
  format, niche, scheduled_for, ...features
});

if (prediction.expected_score < 60) {
  // Skip — would be a flop, save the cost
  log.info({ skipped: true, prediction });
  return;
}
```

Saves ~30-40% of LLM + video gen costs by not making content that won't perform.

### Auto-rebalance (weekly)

```typescript
// Run every Monday morning
const channelROI = await computeROIPerChannel();
//   { tiktok: 4.5, pinterest: 7.2, telegram: 12.0, ... }

// Shift allocation toward higher ROI
const newWeights = applyExpKelly(channelROI, currentWeights);

// But cap concentration at MAX_CHANNEL_CONCENTRATION (default 0.4)
const safeWeights = capConcentration(newWeights, 0.4);

await persistChannelWeights(safeWeights);
```

Affects: how many stories generate for each channel per day.

### Kill-switch

```typescript
// Continuous monitoring
const baseline = await getReachBaseline(account);
const recent = await getRecentReach(account, last3Posts);

if (recent < baseline * 0.3 && consecutivePosts >= 3) {
  // Likely shadowban
  await pauseAccount(account, hours: 168);
  await alert("Account possibly shadowbanned", { account });
}
```

---

## New env vars

```bash
# ML
ML_RETRAIN_INTERVAL_DAYS=14
ML_MIN_TRAINING_SAMPLES=200
ML_PREDICTION_THRESHOLD=60

# A/B
AB_MIN_IMPRESSIONS_FOR_SIGNIFICANCE=1000
AB_DEFAULT_DURATION_DAYS=14

# Auto-rebalance
REBALANCE_INTERVAL_DAYS=7
EXPLORATION_BUDGET_PCT=0.20

# Google Search Console (free, OAuth)
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=./secrets/google-service-account.json
GOOGLE_SEARCH_CONSOLE_PROPERTY=https://yourdomain.com/

FEATURE_LAYER_10_PERFORMANCE_INTEL=true
FEATURE_LAYER_4_OPTIMIZATION=true
```

---

## Cron additions

```typescript
{ name: "collectAnalytics",   cron: "0 */2 * * *",  description: "Pull metrics from all platforms" },
{ name: "computeAttribution", cron: "0 4 * * *",    description: "Daily multi-touch attribution" },
{ name: "evaluateAbTests",    cron: "0 6 * * *",    description: "Check A/B significance" },
{ name: "autoRebalance",      cron: "0 9 * * 1",    description: "Weekly channel rebalance (Mon)" },
{ name: "mlRetrain",          cron: "0 3 * * 1",    description: "Weekly ML retrain" },
{ name: "killSwitchScan",     cron: "*/30 * * * *", description: "Detect shadowbans" },
```

---

## Tooling needed

```bash
# LightGBM (option 1: via Node)
bun add lightgbm

# OR (option 2: Python subprocess)
apt install -y python3-pip
pip install lightgbm pandas scikit-learn

# Stats library
bun add simple-statistics
```

---

## Validation checklist

- [ ] Analytics flowing for all 6+ platforms
- [ ] At least 1 cross-platform attribution path detected
- [ ] First ML model trained, MAE < 30% on reach prediction
- [ ] Pre-publish filter active, ≥20% of low-confidence content skipped
- [ ] At least 3 A/B tests completed with significance
- [ ] Auto-rebalance ran ≥4 weeks, channel mix shifted measurably
- [ ] Kill-switch triggered correctly on at least one stress test
- [ ] Revenue per labor-hour increased ≥40% vs Phase 3

---

## Risks specific to Phase 4

| Risk | Mitigation |
|---|---|
| ML overfits on small data | Strict train/val split; require min sample size |
| Attribution noise from cookieless tracking | Use UTM + sub-IDs religiously; conservative weights |
| Auto-rebalance over-corrects | Smoothing factor (0.7 prev + 0.3 new); cap weight changes |
| Kill-switch false positives | Require 3+ consecutive low-reach posts before pausing |
| ML predictions become self-fulfilling | Reserve 20% budget for exploration ignoring predictions |

---

**Estimated build time**: 1-2 chat sessions if focused, 4-6 weeks calendar
**Hardest part**: feature engineering + multi-touch attribution
**Skip if**: < 60 days analytics data; ML on small data is worse than heuristics
