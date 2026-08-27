import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface DailyReportInsights {
  summary: string;
  performanceTrends: string;
  anomalies: string;
  topIssues: string;
  recommendations: string;
}

export async function analyzeDailyReport(stats: unknown): Promise<DailyReportInsights> {
  const prompt = `You are an application observability analyst.
You have been given verified, pre-calculated statistics for a Node.js application running on AWS EC2.
Do NOT recalculate or question the numbers — they are accurate.
Your job is to interpret the data and provide clear, concise insights.

Statistics for the reporting period:
${JSON.stringify(stats, null, 2)}

Return ONLY valid JSON using exactly this structure:
{
  "summary": "2-3 sentence executive summary of the day",
  "performanceTrends": "key performance observations based on response times and throughput",
  "anomalies": "any unusual patterns, spikes, or deviations worth noting — or 'None detected' if everything looks normal",
  "topIssues": "the most significant problems observed, referencing specific endpoints or error codes — or 'None' if error rate is low",
  "recommendations": "1-3 specific, actionable recommendations based on the data"
}

Rules:
- Be specific — reference actual numbers from the data.
- Be concise — each field should be 1-3 sentences.
- Do not invent data not present in the statistics.
- If traffic was very low or zero, say so clearly.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response for daily report");

  return JSON.parse(text) as DailyReportInsights;
}
