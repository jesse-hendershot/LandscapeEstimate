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
