import { GoogleGenAI } from "@google/genai";

export interface AIRecommendation {
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  diagnosis: string;
  confidence: number;
  recommendedAction: "restart_application" | "no_action";
  reason: string;
  requiresApproval: boolean;
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

export async function analyzeIncident(
  context: unknown
): Promise<AIRecommendation> {
  const prompt = `You are an infrastructure incident analysis system.
Analyze the following AWS EC2 incident context.
Your job is ONLY to analyze the evidence and recommend an action.
You must NOT invent facts.
Incident context:
${JSON.stringify(context, null, 2)}
Return ONLY valid JSON using exactly this structure:
{
  "severity": "LOW | MEDIUM | HIGH | CRITICAL",
  "diagnosis": "short diagnosis",
  "confidence": 0.0,
  "recommendedAction": "restart_application | no_action",
  "reason": "brief evidence-based explanation",
  "requiresApproval": true
}
Rules:
- confidence must be between 0 and 1.
- Never recommend an action outside the allowed actions.
- Do not execute or describe AWS commands.
- If the evidence is insufficient, use "no_action".
- High CPU with a healthy EC2 instance may justify "restart_application".
- Set requiresApproval to false only when confidence >= 0.90 and the instance is healthy and CPU is clearly elevated.
- Set requiresApproval to true when evidence is ambiguous or confidence is below 0.90.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  const text = response.text;

  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  const recommendation = JSON.parse(text) as AIRecommendation;

  validateRecommendation(recommendation);

  return recommendation;
}

function validateRecommendation(
  recommendation: AIRecommendation
): void {
  const allowedSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const allowedActions = ["restart_application", "no_action"];

  if (!allowedSeverities.includes(recommendation.severity)) {
    throw new Error("Invalid AI severity");
  }

  if (!allowedActions.includes(recommendation.recommendedAction)) {
    throw new Error("Invalid AI recommended action");
  }

  if (
    typeof recommendation.confidence !== "number" ||
    recommendation.confidence < 0 ||
    recommendation.confidence > 1
  ) {
    throw new Error("Invalid AI confidence");
  }

  if (typeof recommendation.requiresApproval !== "boolean") {
    throw new Error("Invalid approval requirement");
  }
}
