import { strict as assert } from "node:assert";
import { test } from "node:test";

import { parseClar } from "./Clarifications";

test("question shapes the prompt asks for become tap-able inputs", () => {
  assert.deepEqual(parseClar("How long is the drain run, in feet?"), { type: "number" });
  assert.deepEqual(parseClar("Does the drain need a pop-up emitter at the outlet?"), { type: "yesno" });
  assert.deepEqual(parseClar("Plastic or steel edging?"), { type: "choice", choices: ["Plastic", "steel edging"] });
  assert.deepEqual(parseClar("Do you want sod or seed?"), { type: "choice", choices: ["sod", "seed"] });
  assert.deepEqual(parseClar("Will disturbed lawn be restored with sod or seed?"), { type: "choice", choices: ["sod", "seed"] });
  assert.deepEqual(parseClar("Is the drain pipe 4 in or 6 in?").choices, ["4 in", "6 in"]);
  assert.equal(parseClar("Anything else we should know about access to the backyard").type, "text");
});

test("questions from the first live run", () => {
  // Was Yes/No: "should the trench" looked like a yes/no question.
  assert.deepEqual(parseClar("How deep should the trench be, in inches?"), { type: "number" });
  // Were radio choices "yes" / "no" instead of the Yes/No buttons.
  assert.deepEqual(parseClar("Does the site have at least 1% fall from the drain start to the outlet, yes or no?"), { type: "yesno" });
  assert.deepEqual(parseClar("Should we restore sod/topsoil over the trench after backfill, yes or no?"), { type: "yesno" });
  assert.deepEqual(parseClar("Is there a downspout to tie in (yes/no)?"), { type: "yesno" });
});
