import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeIdNumber } from "@/lib/ids/ph-ids";

/**
 * Lightweight duplicate / collusion signals for the review queues. Catches the
 * cheap-but-common abuse: the same person on multiple accounts (shared contact
 * number) or a re-used government ID number. Shared contact also flags
 * buyer↔seller collusion (one person cashing out their own credit line through a
 * seller account they control). Best-effort heuristics, not proof.
 */

export async function fraudFlagsForUsers(
  userIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;

  const admin = createAdminClient();
  const [{ data: users }, { data: buyers }, { data: sellers }] =
    await Promise.all([
      admin.from("users").select("id, contact"),
      admin.from("buyer_profiles").select("user_id, application"),
      admin.from("seller_profiles").select("user_id"),
    ]);

  // contact -> set of user ids
  const byContact = new Map<string, Set<string>>();
  for (const u of users ?? []) {
    const c = (u.contact ?? "").trim().toLowerCase();
    if (!c) continue;
    if (!byContact.has(c)) byContact.set(c, new Set());
    byContact.get(c)!.add(u.id);
  }
  const contactOf = new Map(
    (users ?? []).map((u) => [u.id, (u.contact ?? "").trim().toLowerCase()]),
  );

  // id number -> set of buyer user ids, and each buyer's own id number
  const byIdNo = new Map<string, Set<string>>();
  const idNoOf = new Map<string, string>();
  for (const b of buyers ?? []) {
    const app = (b.application as Record<string, unknown> | null) ?? null;
    // Normalize (strip separators, uppercase) so "1234-5678" and "12345678"
    // collide even if older rows were stored before normalization on submit.
    const idno = normalizeIdNumber(String(app?.id_number ?? ""));
    if (!idno) continue;
    idNoOf.set(b.user_id, idno);
    if (!byIdNo.has(idno)) byIdNo.set(idno, new Set());
    byIdNo.get(idno)!.add(b.user_id);
  }

  const sellerIds = new Set((sellers ?? []).map((s) => s.user_id));
  const buyerIds = new Set((buyers ?? []).map((b) => b.user_id));

  for (const id of userIds) {
    const flags: string[] = [];

    const c = contactOf.get(id);
    if (c) {
      const shared = byContact.get(c);
      if (shared && shared.size > 1) {
        flags.push(`Shared contact number with ${shared.size - 1} other account(s)`);
        // Same contact spans a buyer and a seller account → collusion risk.
        const others = [...shared].filter((x) => x !== id);
        const spansRoles = others.some(
          (x) =>
            (buyerIds.has(id) && sellerIds.has(x)) ||
            (sellerIds.has(id) && buyerIds.has(x)) ||
            (buyerIds.has(x) && sellerIds.has(x)),
        );
        if (spansRoles) {
          flags.push("Contact links a buyer and a seller account (collusion risk)");
        }
      }
    }

    const idno = idNoOf.get(id);
    if (idno) {
      const shared = byIdNo.get(idno);
      if (shared && shared.size > 1) {
        flags.push(`Duplicate ID number on ${shared.size - 1} other application(s)`);
      }
    }

    if (flags.length > 0) out.set(id, flags);
  }
  return out;
}
