#include "hems_nilm.h"
#include "nilm_model.h"
#include <math.h>
#include <string.h>

/* ═══ NilmPhaseDetector — port of event_detector.py ═════════════════════ */

void NilmPhaseDetector::reset(int settleWindow, double steadyBandW, double dpMinW) {
  W = settleWindow > NILM_MAX_SETTLE ? NILM_MAX_SETTLE : settleWindow;
  eps = steadyBandW;
  dpMin = dpMinW;
  bufCount = 0;
  bufHead = 0;
  hasBase = false;
  baseP = baseQ = 0.0;
}

bool NilmPhaseDetector::settled() const {
  if (bufCount < W) return false;
  double mn = bufP[0], mx = bufP[0];
  for (int i = 1; i < W; i++) {
    if (bufP[i] < mn) mn = bufP[i];
    if (bufP[i] > mx) mx = bufP[i];
  }
  return (mx - mn) <= eps;
}

void NilmPhaseDetector::level(double &lp, double &lq) const {
  // deque order does not matter for a mean; sum in ring order like Python's
  // sum(buf) over append order to keep floating-point summation identical:
  // oldest element sits at bufHead when the ring is full.
  double sp = 0.0, sq = 0.0;
  for (int i = 0; i < W; i++) {
    int idx = (bufHead + i) % W;
    sp += bufP[idx];
    sq += bufQ[idx];
  }
  lp = sp / W;
  lq = sq / W;
}

bool NilmPhaseDetector::process(double t, double p, double q,
                                double &dP, double &dQ, int8_t &sign, double &levelP) {
  (void)t;
  // deque(maxlen=W) append
  if (bufCount < W) {
    bufP[bufCount] = p;
    bufQ[bufCount] = q;
    bufCount++;
  } else {
    bufP[bufHead] = p;
    bufQ[bufHead] = q;
    bufHead = (bufHead + 1) % W;
  }

  if (!settled()) return false;

  double lp, lq;
  level(lp, lq);

  if (!hasBase) {
    hasBase = true;
    baseP = lp;
    baseQ = lq;
    return false;
  }

  double step = lp - baseP;
  if (fabs(step) > dpMin) {
    dP = step;
    dQ = lq - baseQ;
    sign = step > 0 ? 1 : -1;
    levelP = lp;
    baseP = lp;
    baseQ = lq;
    return true;
  }

  baseP = lp;   // settled but sub-threshold: track drift, emit nothing
  baseQ = lq;
  return false;
}

/* ═══ NilmClassifier — port of classifier.py predict() ══════════════════ */

int16_t NilmClassifier::predict(double dp, double dq, uint32_t allowedMask, double &dist) {
  const double z0 = (fabs(dp) - NILM_MU[0]) / NILM_SIGMA[0];
  const double z1 = (fabs(dq) - NILM_MU[1]) / NILM_SIGMA[1];

  // k smallest distances among allowed classes, ties broken by index
  // (mirrors np.argsort over the masked subset)
  double bestD[NILM_KNN_K];
  int bestI[NILM_KNN_K];
  int found = 0;

  for (int i = 0; i < NILM_NUM_TRAIN; i++) {
    if (!(allowedMask & (1u << NILM_TRAIN_Y[i]))) continue;
    const double a = NILM_TRAIN_X[i][0] - z0;
    const double b = NILM_TRAIN_X[i][1] - z1;
    const double d = sqrt(a * a + b * b);

    int pos = found < NILM_KNN_K ? found : NILM_KNN_K;
    // insertion position: strictly closer wins; equal distance keeps the
    // earlier training index first (stable order)
    while (pos > 0 && d < bestD[pos - 1]) pos--;
    if (pos >= NILM_KNN_K) continue;
    for (int s = (found < NILM_KNN_K ? found : NILM_KNN_K - 1); s > pos; s--) {
      bestD[s] = bestD[s - 1];
      bestI[s] = bestI[s - 1];
    }
    bestD[pos] = d;
    bestI[pos] = i;
    if (found < NILM_KNN_K) found++;
  }

  if (found == 0) {
    dist = INFINITY;
    return -1;
  }
  dist = bestD[0];
  if (bestD[0] > NILM_TAU) return -1;   // rejection: unknown load

  // inverse-distance voting; first-seen class wins ties (Python dict order)
  double voteVal[NILM_KNN_K];
  uint8_t voteCls[NILM_KNN_K];
  int nVotes = 0;
  for (int n = 0; n < found; n++) {
    const uint8_t cls = NILM_TRAIN_Y[bestI[n]];
    const double w = 1.0 / (bestD[n] + 1e-6);
    int v = 0;
    while (v < nVotes && voteCls[v] != cls) v++;
    if (v == nVotes) {
      voteCls[nVotes] = cls;
      voteVal[nVotes] = 0.0;
      nVotes++;
    }
    voteVal[v] += w;
  }
  int best = 0;
  for (int v = 1; v < nVotes; v++) {
    if (voteVal[v] > voteVal[best]) best = v;
  }
  return (int16_t)voteCls[best];
}

/* ═══ NilmPhaseAttributor — port of attribution.py ══════════════════════ */

void NilmPhaseAttributor::reset(int phaseIdx, double dtS, double quiescentW,
                                double overTolW, double bgNominalW) {
  (void)phaseIdx;
  dt = dtS;
  quiescent = quiescentW;
  overTol = overTolW;
  bgNominal = bgNominalW;
  nActive = 0;
  memset(energyWh, 0, sizeof(energyWh));
  unknownWhAcc = backgroundWhAcc = 0.0;
  unknownSeq = 0;
  negRun = 0;
}

void NilmPhaseAttributor::accrue(int32_t labelId, double wh) {
  if (labelId < 0) unknownWhAcc += wh;                 // "unknown_N"
  else if (labelId < NILM_NUM_CLASSES) energyWh[labelId] += wh;
}

void NilmPhaseAttributor::removeAt(int idx) {
  for (int i = idx; i < nActive - 1; i++) active[i] = active[i + 1];
  nActive--;
}

void NilmPhaseAttributor::onEvent(double dP, double dQ, int8_t sign, int16_t classId) {
  if (sign > 0) {                                      // turn-ON
    if (nActive >= NILM_MAX_ACTIVE) return;            // bounded (never hit in parity)
    int32_t id = classId;
    if (classId < 0) id = -2 - (unknownSeq++);         // anonymised unknown instance
    active[nActive].labelId = id;
    active[nActive].power = fabs(dP);
    active[nActive].q = fabs(dQ);
    nActive++;
    return;
  }

  // turn-OFF: close the matching active load
  const double target = fabs(dP);

  // same-label candidates (named classes only can match; incoming unknown is
  // -1 and stored unknowns are <=-2, so they never label-match — as in Python)
  int best = -1;
  double bestDiff = 0.0;
  for (int i = 0; i < nActive; i++) {
    if (active[i].labelId == classId) {
      const double diff = fabs(active[i].power - target);
      if (best < 0 || diff < bestDiff) {
        best = i;
        bestDiff = diff;
      }
    }
  }
  if (best >= 0) {                                     // lenient same-type match
    if (bestDiff <= 0.30 * target + 25.0) removeAt(best);
    return;
  }

  if (nActive > 0) {                                   // tight any-load match
    best = 0;
    bestDiff = fabs(active[0].power - target);
    for (int i = 1; i < nActive; i++) {
      const double diff = fabs(active[i].power - target);
      if (diff < bestDiff) {
        best = i;
        bestDiff = diff;
      }
    }
    if (bestDiff <= 0.12 * target + 15.0) removeAt(best);
    // else: orphan/merged off — corrector/resync reconciles
  }
}

double NilmPhaseAttributor::step(double t, double measuredP) {
  (void)t;
  for (int i = 0; i < nActive; i++) {
    accrue(active[i].labelId, active[i].power * dt / 3600.0);
  }

  double assigned = 0.0;
  for (int i = 0; i < nActive; i++) assigned += active[i].power;
  const double residual = measuredP - assigned;

  if (residual > 0) backgroundWhAcc += residual * dt / 3600.0;

  if (residual < -overTol && nActive > 0) negRun++;
  else negRun = 0;

  if (negRun >= 3 && nActive > 0) {                    // sustained → self-correct
    const double overshoot = -residual + bgNominal;
    int best = 0;
    double bestDiff = fabs(active[0].power - overshoot);
    for (int i = 1; i < nActive; i++) {
      const double diff = fabs(active[i].power - overshoot);
      if (diff < bestDiff) {
        best = i;
        bestDiff = diff;
      }
    }
    if (bestDiff <= 0.4 * overshoot) {
      removeAt(best);
      negRun = 0;
    }
  }

  if (measuredP <= quiescent && nActive > 0) nActive = 0;   // hard resync

  return residual;
}

double NilmPhaseAttributor::namedWh(int16_t classId) const {
  return (classId >= 0 && classId < NILM_NUM_CLASSES) ? energyWh[classId] : 0.0;
}

/* ═══ HemsNilm — port of pipeline.py ════════════════════════════════════ */

void HemsNilm::begin() {
  for (int ph = 0; ph < 3; ph++) {
    detectors[ph].reset(NILM_SETTLE_WINDOW, NILM_STEADY_BAND_W, NILM_DP_MIN_W);
    attributors[ph].reset(ph, NILM_SAMPLE_PERIOD_S, NILM_QUIESCENT_W,
                          NILM_OVER_TOL_W, NILM_BACKGROUND_W[ph]);
  }
  qHead = 0;
  qCount = 0;
}

void HemsNilm::push(const HemsNilmEvent &ev) {
  if (qCount >= NILM_EVENT_QUEUE) {                    // drop oldest
    qHead = (qHead + 1) % NILM_EVENT_QUEUE;
    qCount--;
  }
  queue[(qHead + qCount) % NILM_EVENT_QUEUE] = ev;
  qCount++;
}

int HemsNilm::processSample(double t, const double p[3], const double q[3]) {
  int emitted = 0;
  for (int ph = 0; ph < 3; ph++) {
    double dP, dQ, levelP;
    int8_t sign;
    if (detectors[ph].process(t, p[ph], q[ph], dP, dQ, sign, levelP)) {
      double dist;
      const int16_t cls = NilmClassifier::predict(dP, dQ, NILM_PHASE_MASK[ph], dist);
      attributors[ph].onEvent(dP, dQ, sign, cls);

      HemsNilmEvent ev;
      ev.t = t;
      ev.phase = (uint8_t)ph;
      ev.dP = dP;
      ev.dQ = dQ;
      ev.sign = sign;
      ev.levelP = levelP;
      ev.classId = cls;
      ev.label = className(cls);
      ev.dist = dist;
      const double c = (cls >= 0 && NILM_TAU > 0) ? 1.0 - dist / NILM_TAU : 0.0;
      ev.confidence = (float)(c < 0 ? 0 : (c > 1 ? 1 : c));
      ev.on = sign > 0;
      push(ev);
      emitted++;
    }
    attributors[ph].step(t, p[ph]);
  }
  return emitted;
}

bool HemsNilm::popEvent(HemsNilmEvent &out) {
  if (qCount == 0) return false;
  out = queue[qHead];
  qHead = (qHead + 1) % NILM_EVENT_QUEUE;
  qCount--;
  return true;
}

double HemsNilm::namedWh(int phase, int16_t classId) const {
  return attributors[phase].namedWh(classId);
}
double HemsNilm::unknownWh(int phase) const { return attributors[phase].unknownWh(); }
double HemsNilm::backgroundWh(int phase) const { return attributors[phase].backgroundWh(); }

int HemsNilm::numClasses() { return NILM_NUM_CLASSES; }

const char* HemsNilm::className(int16_t id) {
  if (id < 0 || id >= NILM_NUM_CLASSES) return "unknown";
  return NILM_CLASS_NAMES[id];
}
