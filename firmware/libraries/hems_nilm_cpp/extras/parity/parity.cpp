/* Host-compiled parity harness: runs the C++ port over the same
 * day_stream.csv the Python pipeline consumed and prints the event log +
 * energy report in a canonical text format. compare_parity.py diffs this
 * against the Python reference.json.
 *
 * Build & run (from repo root):
 *   firmware/libraries/hems_nilm_cpp/extras/parity/run_parity.sh
 */
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "hems_nilm.h"
#include "nilm_model.h"

static const char PHASE_NAMES[3][2] = {"A", "B", "C"};

int main(int argc, char** argv) {
  const char* streamPath = argc > 1 ? argv[1] : "nilm/day_stream.csv";
  FILE* f = fopen(streamPath, "r");
  if (!f) {
    fprintf(stderr, "cannot open %s\n", streamPath);
    return 2;
  }

  char line[1024];
  if (!fgets(line, sizeof line, f)) return 2;   // header

  // column indices for t and P_/Q_ per phase, discovered from the header
  int colT = -1, colP[3] = {-1, -1, -1}, colQ[3] = {-1, -1, -1};
  {
    int col = 0;
    for (char* tok = strtok(line, ",\r\n"); tok; tok = strtok(nullptr, ",\r\n"), col++) {
      if (!strcmp(tok, "t")) colT = col;
      for (int ph = 0; ph < 3; ph++) {
        char nameP[8], nameQ[8];
        snprintf(nameP, sizeof nameP, "P_%s", PHASE_NAMES[ph]);
        snprintf(nameQ, sizeof nameQ, "Q_%s", PHASE_NAMES[ph]);
        if (!strcmp(tok, nameP)) colP[ph] = col;
        if (!strcmp(tok, nameQ)) colQ[ph] = col;
      }
    }
  }
  if (colT < 0) {
    fprintf(stderr, "no 't' column\n");
    return 2;
  }

  HemsNilm nilm;
  nilm.begin();

  printf("EVENTS\n");
  long nSamples = 0, nEvents = 0;
  while (fgets(line, sizeof line, f)) {
    double vals[64];
    int col = 0;
    for (char* tok = strtok(line, ",\r\n"); tok && col < 64; tok = strtok(nullptr, ",\r\n"), col++) {
      vals[col] = strtod(tok, nullptr);
    }
    double p[3], q[3];
    for (int ph = 0; ph < 3; ph++) {
      p[ph] = vals[colP[ph]];
      q[ph] = vals[colQ[ph]];
    }
    nilm.processSample(vals[colT], p, q);
    HemsNilmEvent ev;
    while (nilm.popEvent(ev)) {
      // dist printed rounded to 3 dp, matching pipeline.py's round(dist, 3)
      printf("%.6f,%s,%.9f,%.9f,%d,%s,%.3f\n",
             ev.t, PHASE_NAMES[ev.phase], ev.dP, ev.dQ, (int)ev.sign,
             ev.classId >= 0 ? ev.label : "unknown", ev.dist);
      nEvents++;
    }
    nSamples++;
  }
  fclose(f);

  printf("REPORT\n");
  for (int ph = 0; ph < 3; ph++) {
    for (int c = 0; c < HemsNilm::numClasses(); c++) {
      double wh = nilm.namedWh(ph, (int16_t)c);
      if (wh > 0.0) {
        printf("%s,%s,%.9f\n", PHASE_NAMES[ph], HemsNilm::className((int16_t)c), wh);
      }
    }
    printf("%s,[unknown],%.9f\n", PHASE_NAMES[ph], nilm.unknownWh(ph));
    printf("%s,[background],%.9f\n", PHASE_NAMES[ph], nilm.backgroundWh(ph));
  }
  fprintf(stderr, "processed %ld samples, %ld events\n", nSamples, nEvents);
  return 0;
}
