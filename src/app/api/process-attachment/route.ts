import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import OpenAI from "openai";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const type = file.type;
  let text = "";

  try {
    if (
      type.startsWith("text/") ||
      type === "application/json" ||
      file.name.endsWith(".md") ||
      file.name.endsWith(".csv")
    ) {
      text = await file.text();
      if (text.length > 15000) {
        text = text.slice(0, 15000) + "\n\n[Content truncated — file was very long]";
      }
    } else if (type === "application/pdf") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { PDFParse } = await import("pdf-parse");
      const pdf = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await pdf.getText();
      text = result.text;
      await pdf.destroy();
      if (text.length > 15000) {
        text = text.slice(0, 15000) + "\n\n[Content truncated — PDF was very long]";
      }
    } else if (type.startsWith("image/")) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const base64 = buffer.toString("base64");
      const dataUri = `data:${type};base64,${base64}`;

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe everything in this image in detail. Focus on any text, messages, emails, numbers, or important content visible. Be thorough and specific — this will be used as context in a conversation.",
              },
              {
                type: "image_url",
                image_url: { url: dataUri },
              },
            ],
          },
        ],
        max_tokens: 1500,
      });
      text = response.choices[0].message.content || "";
    } else {
      return NextResponse.json(
        { error: "Unsupported file type" },
        { status: 400 }
      );
    }

    return NextResponse.json({ text, fileName: file.name });
  } catch (err) {
    console.error("[ATTACHMENT] Processing error:", err);
    return NextResponse.json(
      { error: "Failed to process file" },
      { status: 500 }
    );
  }
}
