/**
 * One conversation per quote, between the client and the FlySales team. We are
 * the counterparty, so there is never a per-supplier thread and sourcing
 * collaborators have no access to this at all.
 */
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Pin, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import {
  adminListQuoteMessages,
  adminPinQuoteMessage,
  adminPostQuoteMessage,
  getThreadAttachmentUrls,
  listQuoteMessages,
  markQuoteThreadRead,
  postQuoteMessage,
} from "@/lib/quote-thread.functions";
import { cn } from "@/lib/utils";

export function QuoteThread({ quoteId, mode }: { quoteId: string; mode: "client" | "admin" }) {
  const queryClient = useQueryClient();
  const isAdmin = mode === "admin";
  const fetchMessages = useServerFn(isAdmin ? adminListQuoteMessages : listQuoteMessages);
  const callPost = useServerFn(isAdmin ? adminPostQuoteMessage : postQuoteMessage);
  const callPin = useServerFn(adminPinQuoteMessage);
  const callUrls = useServerFn(getThreadAttachmentUrls);

  const [body, setBody] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ["quote-thread", quoteId, mode],
    queryFn: () => fetchMessages({ data: { quote_id: quoteId } }),
  });
  const messages = data?.messages ?? [];

  // Opening the thread clears the client's unread badge.
  const callMarkRead = useServerFn(markQuoteThreadRead);
  useEffect(() => {
    if (isAdmin) return;
    void callMarkRead({ data: { quote_id: quoteId } }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["my-quote-signals"] });
    });
  }, [isAdmin, quoteId, callMarkRead, queryClient]);

  const attachmentPaths = [...new Set(messages.flatMap((m) => m.attachments ?? []))];
  const { data: urlData } = useQuery({
    queryKey: ["quote-thread-urls", quoteId, attachmentPaths.join("|")],
    queryFn: () => callUrls({ data: { quote_id: quoteId, paths: attachmentPaths } }),
    enabled: attachmentPaths.length > 0,
  });
  const urlByPath = new Map((urlData?.urls ?? []).map((u) => [u.path, u.url]));

  const post = useMutation({
    mutationFn: () =>
      callPost({ data: { quote_id: quoteId, body, attachments: pending } }),
    onSuccess: () => {
      setBody("");
      setPending([]);
      void queryClient.invalidateQueries({ queryKey: ["quote-thread", quoteId] });
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  const pin = useMutation({
    mutationFn: (vars: { id: string; pinned: boolean }) =>
      callPin({ data: { message_id: vars.id, pinned: vars.pinned } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["quote-thread", quoteId] }),
    onError: (err) => toast.error(friendlyError(err)),
  });

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const { data: session } = await supabase.auth.getUser();
      const uid = session.user?.id;
      if (!uid) throw new Error("Sign in again to attach images");
      const paths: string[] = [];
      for (const file of Array.from(files).slice(0, 5)) {
        const path = `${uid}/thread/${quoteId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const { error } = await supabase.storage.from("quote-images").upload(path, file);
        if (error) throw new Error(error.message);
        paths.push(path);
      }
      setPending((prev) => [...prev, ...paths]);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const pinned = messages.filter((m) => m.pinned);
  const ordered = [...pinned, ...messages.filter((m) => !m.pinned)];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Conversation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
          {ordered.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No messages yet. Ask us anything about this quote — pricing, samples, materials.
            </p>
          )}
          {ordered.map((m) => {
            if (m.kind === "system") {
              return (
                <div key={m.id} className="text-center text-xs text-muted-foreground">
                  {m.body} · {formatDateTime(m.created_at)}
                </div>
              );
            }
            const mine = isAdmin ? m.author_role === "admin" : m.author_role === "client";
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl border border-border p-3",
                    mine ? "bg-primary/10" : "bg-muted/40",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{m.author_role === "admin" ? "FlySales team" : "You"}</span>
                    <span>{formatDateTime(m.created_at)}</span>
                    {m.pinned && <Badge variant="secondary">Pinned</Badge>}
                    {isAdmin && (
                      <button
                        type="button"
                        className="hover:text-foreground"
                        onClick={() => pin.mutate({ id: m.id, pinned: !m.pinned })}
                      >
                        <Pin className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {m.body && <p className="whitespace-pre-wrap text-sm">{m.body}</p>}
                  {(m.attachments ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(m.attachments ?? []).map((p) => {
                        const url = urlByPath.get(p);
                        return url ? (
                          <a key={p} href={url} target="_blank" rel="noreferrer">
                            <img
                              src={url}
                              alt="Attachment"
                              className="h-16 w-16 rounded-lg border border-border object-cover"
                            />
                          </a>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a message…"
            rows={3}
            maxLength={4000}
          />
          {pending.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {pending.length} image{pending.length === 1 ? "" : "s"} attached
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void upload(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Attach"}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={post.isPending || (!body.trim() && pending.length === 0)}
              onClick={() => post.mutate()}
            >
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
