import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FlagInstance } from "@/types/api";

const state = vi.hoisted(() => ({
  flags: [] as Partial<FlagInstance>[],
  isFetching: false,
  urls: [] as string[],
  navigate: vi.fn(),
}));

vi.mock("@refinedev/core", () => ({
  useCustom: ({ url, queryOptions }: { url: string; queryOptions: { enabled: boolean } }) => {
    if (queryOptions.enabled) state.urls.push(url);
    return {
      query: {
        data: queryOptions.enabled ? { data: { data: state.flags } } : undefined,
        isFetching: state.isFetching,
      },
    };
  },
  useTranslate: () => (key: string) => key,
}));
vi.mock("@/hooks/use-active-team", () => ({
  useActiveTeam: () => ({ activeTeamId: "t1" }),
}));
vi.mock("react-router", () => ({ useNavigate: () => state.navigate }));

import { FlagQuickJump } from "./flag-quick-jump";

const checkout = { id: "f1", name: "new-checkout", flagsetName: "web" };
const banner = { id: "f2", name: "promo-banner", flagsetName: "mobile" };

beforeEach(() => {
  state.flags = [checkout, banner];
  state.isFetching = false;
  state.urls = [];
  state.navigate.mockReset();
});

describe("FlagQuickJump", () => {
  const shortcuts = [
    { name: "cmd+k opens", init: { key: "k", metaKey: true }, wantOpen: true },
    { name: "ctrl+k opens", init: { key: "k", ctrlKey: true }, wantOpen: true },
    { name: "uppercase K with cmd opens", init: { key: "K", metaKey: true }, wantOpen: true },
    { name: "plain k does nothing", init: { key: "k" }, wantOpen: false },
    { name: "cmd+j does nothing", init: { key: "j", metaKey: true }, wantOpen: false },
  ];
  for (const tt of shortcuts) {
    it(tt.name, () => {
      render(<FlagQuickJump />);
      fireEvent.keyDown(window, tt.init);
      if (tt.wantOpen) {
        expect(screen.getByPlaceholderText("quickJump.placeholder")).toBeInTheDocument();
      } else {
        expect(screen.queryByPlaceholderText("quickJump.placeholder")).toBeNull();
      }
    });
  }

  it("does not query flags while closed", () => {
    render(<FlagQuickJump />);
    expect(state.urls).toEqual([]);
  });

  it("lists flags sorted by name before typing", () => {
    render(<FlagQuickJump />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByText("new-checkout")).toBeInTheDocument();
    expect(screen.getByText("mobile")).toBeInTheDocument();
    expect(state.urls.at(-1)).toMatch(/\/teams\/t1\/flags\?sort=name&pageSize=10$/);
  });

  it("searches the server with the typed name", async () => {
    render(<FlagQuickJump />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await userEvent.type(screen.getByPlaceholderText("quickJump.placeholder"), " promo ");
    await waitFor(() => expect(state.urls.at(-1)).toMatch(/\/teams\/t1\/flags\?.*name=promo$/));
  });

  it("navigates to the selected flag and closes", async () => {
    render(<FlagQuickJump />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await userEvent.click(screen.getByText("promo-banner"));
    expect(state.navigate).toHaveBeenCalledWith("/flags/f2");
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("quickJump.placeholder")).toBeNull(),
    );
  });

  it("navigates to the highlighted flag on Enter", async () => {
    render(<FlagQuickJump />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await userEvent.keyboard("{Enter}");
    expect(state.navigate).toHaveBeenCalledWith("/flags/f1");
  });

  const empties = [
    { name: "shows empty message when nothing matches", isFetching: false, wantEmpty: true },
    { name: "hides empty message while fetching", isFetching: true, wantEmpty: false },
  ];
  for (const tt of empties) {
    it(tt.name, () => {
      state.flags = [];
      state.isFetching = tt.isFetching;
      render(<FlagQuickJump />);
      fireEvent.keyDown(window, { key: "k", metaKey: true });
      expect(screen.queryByText("quickJump.empty") !== null).toBe(tt.wantEmpty);
    });
  }
});
