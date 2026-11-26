import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConversationSummary } from "@/lib/chat";
import { ConversationList, type ListFilter } from "./ConversationList";

const dm = (id: string, name: string, lastAt: string | null = null, unread = 0): ConversationSummary => ({
  key: `dm:${id}` as ConversationSummary["key"], kind: "dm", id, name, subtitle: "Day shift", avatarPath: null,
  lastAt, preview: lastAt ? "testando" : null, unread,
});

const qc = new QueryClient();

function Harness({ list }: { list: ConversationSummary[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  return (
    <QueryClientProvider client={qc}>
    <ConversationList conversations={list} activeKey={null} onSelect={() => {}} search={search} onSearch={setSearch}
      filter={filter} onFilter={setFilter} loading={false} error={null} onRetry={() => {}}
      groupsNotSetUp={false} canCreateGroup={false} onNewGroup={() => {}} />
    </QueryClientProvider>
  );
}

const list = [dm("d", "Daniel Quiló", "2026-10-29T10:34:00Z"), dm("a", "Ailton Junior"), dm("b", "Brendan Cole"), dm("c", "Carla Dias", null, 1)];

describe("ConversationList — conversations first", () => {
  it("shows the people someone talks to, and everybody else behind one button", () => {
    render(<Harness list={list} />);
    expect(screen.getByText("Daniel Quiló")).toBeInTheDocument();
    expect(screen.getByText("Carla Dias")).toBeInTheDocument(); // unread counts as a conversation
    expect(screen.queryByText("Ailton Junior")).toBeNull();
    expect(screen.getByRole("button", { name: /New conversation/ })).toHaveTextContent("2 people");
  });

  it("opens everybody on the button", () => {
    render(<Harness list={list} />);
    fireEvent.click(screen.getByRole("button", { name: /New conversation/ }));
    expect(screen.getByText("Ailton Junior")).toBeInTheDocument();
    expect(screen.getByText("Brendan Cole")).toBeInTheDocument();
  });

  it("lists everybody straight away when there is no conversation yet", () => {
    render(<Harness list={[dm("a", "Ailton Junior"), dm("b", "Brendan Cole")]} />);
    expect(screen.getByText("Ailton Junior")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New conversation/ })).toBeNull();
  });
});
