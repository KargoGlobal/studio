import { useEffect, useState } from "react";
import { useCustom, useTranslate } from "@refinedev/core";
import { keepPreviousData } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useActiveTeam } from "@/hooks/use-active-team";
import { API_URL } from "@/providers/constants";
import type { FlagInstance, PaginatedResponse } from "@/types/api";

const RESULT_LIMIT = 10;

// FlagQuickJump is the Cmd/Ctrl+K palette: type a flag name, pick a match,
// land on its detail page. Matching is done server-side (the team may have
// more flags than one page), so cmdk's own filtering is turned off.
export function FlagQuickJump() {
  const t = useTranslate();
  const navigate = useNavigate();
  const { activeTeamId } = useActiveTeam();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => clearTimeout(id);
  }, [search]);

  const qs = new URLSearchParams({
    sort: "name",
    pageSize: String(RESULT_LIMIT),
    ...(debouncedSearch && { name: debouncedSearch }),
  }).toString();
  const { query } = useCustom<PaginatedResponse<FlagInstance>>({
    url: `${API_URL}/teams/${activeTeamId}/flags?${qs}`,
    method: "get",
    queryOptions: {
      queryKey: ["team-flags", activeTeamId, qs],
      enabled: open && !!activeTeamId,
      placeholderData: keepPreviousData,
    },
  });
  const flags = query.data?.data?.data ?? [];

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("quickJump.title")}
      description={t("quickJump.placeholder")}
      shouldFilter={false}
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={t("quickJump.placeholder")}
      />
      <CommandList>
        {!query.isFetching && <CommandEmpty>{t("quickJump.empty")}</CommandEmpty>}
        {flags.map((f) => (
          <CommandItem
            key={f.id}
            value={f.id}
            onSelect={() => {
              onOpenChange(false);
              navigate(`/flags/${f.id}`);
            }}
          >
            <span className="truncate font-mono">{f.name}</span>
            <span className="text-muted-foreground ml-auto truncate text-xs">
              {f.flagsetName}
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
