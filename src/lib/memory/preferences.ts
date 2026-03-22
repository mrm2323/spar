import { clerkClient } from "@clerk/nextjs/server";

const MEMORY_PREF_KEY = "useMemoryInCoaching";

export async function getMemoryPreference(userId: string): Promise<boolean> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const value = user.publicMetadata?.[MEMORY_PREF_KEY];
    if (typeof value === "boolean") return value;
    return true;
  } catch (err) {
    console.error("[MEMORY PREF] Failed to read preference:", err);
    // Fail open so memory still works if Clerk metadata fetch is unavailable.
    return true;
  }
}

export async function setMemoryPreference(
  userId: string,
  enabled: boolean
): Promise<void> {
  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    publicMetadata: {
      [MEMORY_PREF_KEY]: enabled,
    },
  });
}
