import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import OpenAI from "openai";

const MAX_BASE64 = 6 * 1024 * 1024; // ~4.5MB base64 guard

/**
 * Describe what's on the user's screen (from a JPEG/PNG frame) so Kabir can use it in voice.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Screen context is not configured." },
      { status: 503 }
    );
  }

  try {
    const body = (await req.json()) as {
      imageBase64?: string;
      mimeType?: string;
    };
    const raw = body.imageBase64?.trim();
    if (!raw) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }
    if (raw.length > MAX_BASE64) {
      return NextResponse.json({ error: "Image too large" }, { status: 400 });
    }

    const mime = body.mimeType?.includes("png") ? "image/png" : "image/jpeg";
    const dataUri = `data:${mime};base64,${raw}`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `This is a single screenshot from the user's screen while they practice a conversation with Kabir (voice coach).
Describe what is visible in plain English: apps, documents, slides, emails, calendar, code, etc.
Focus on text and structure they might need help with (e.g. resume bullet, email draft, slide title).
Be concise: 4–8 short sentences max. No preamble. If the image is blank or unreadable, say so in one sentence.`,
            },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
    });

    const description = response.choices[0].message.content?.trim() || "";
    if (!description) {
      return NextResponse.json(
        { error: "Could not describe screen" },
        { status: 422 }
      );
    }

    return NextResponse.json({ description });
  } catch (err) {
    console.error("[screen-context]", err);
    return NextResponse.json(
      { error: "Failed to process screen image" },
      { status: 500 }
    );
  }
}
