import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages.js";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { lineItems, answers } = await req.json();

    const prompt = `You are a landscaping materials estimator. The contractor answered clarification questions about their estimate. Based ONLY on those answers, return the line items that need to change.

CURRENT MATERIAL LINE ITEMS:
${JSON.stringify(lineItems, null, 2)}

CONTRACTOR ANSWERS:
${answers}

Return ONLY a JSON object — no prose, no markdown fences, start with { end with }:
{
  "updates": [
    {
      "material": "exact material name from the list above (for update/remove) or new name (for add)",
      "qty": 1,
      "unit": "string",
      "low": 0.00,
      "high": 0.00,
      "source": "string",
      "action": "update"
    }
  ],
  "notes": "one sentence: what changed and why"
}

Rules:
- action must be "update", "add", or "remove"
- For "update": material name must exactly match an item in the list above
- For "remove": only the material and action fields are needed
- For "add": include all fields
- Omit items that don't change — only include affected items
- You may adjust qty, unit, low, high, source based on the contractor's answers
- If no changes are needed, return {"updates": [], "notes": "No changes needed"}`;

    const response = (await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      // NO tools — no web search for refinement
      messages: [{ role: "user", content: prompt }],
    })) as Message;

    console.log("=== REFINE CALL ===");
    console.log("stop_reason:", response.stop_reason);
    console.log("input_tokens:", response.usage?.input_tokens, "output_tokens:", response.usage?.output_tokens);
    console.log("tools used: NONE (no web search)");

    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from Claude" }, { status: 500 });
    }

    let text = textBlock.text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    if (!text.startsWith("{")) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) text = match[0];
      else {
        console.error("Refine raw response:", text);
        return NextResponse.json({ error: "Could not parse refinement response" }, { status: 500 });
      }
    }

    const result = JSON.parse(text);
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("=== REFINE ERROR ===", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
