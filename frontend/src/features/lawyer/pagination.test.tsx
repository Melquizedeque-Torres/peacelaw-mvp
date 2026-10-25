import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type CaseForLawyer } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { LawyerBoard } from "./LawyerBoard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

function make(id: string, over: Partial<CaseForLawyer> = {}): CaseForLawyer {
  return {
    id,
    title: `Caso ${id}`,
    status: "EVALUATED",
    ai_probability_score: 70,
    created_at: "2026-10-14T12:00:00Z",
    anonymized_text: "Texto.",
    evidence_count: 0,
    area: "ALUGUEL",
    suggested: false,
    ...over,
  };
}

const page = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => make(`${prefix}${i}`));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function board() {
  return render(
    <SessionProvider initialState={{ status: "authenticated", user: { id: "l", email: "l@b.com", role: "LAWYER" } }}>
      <LawyerBoard />
    </SessionProvider>,
  );
}

const MORE = { name: "Carregar mais oportunidades" };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
});

describe("lawyer board load more", () => {
  it("has no button when the first page has fewer than 50 opportunities", async () => {
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(page("a", 49));
    board();
    await screen.findByText("Caso a0");
    expect(screen.queryByRole("button", MORE)).not.toBeInTheDocument();
  });

  it("does not count other columns toward hasMore", async () => {
    const mediation = Array.from({ length: 10 }, (_, i) => make(`m${i}`, { status: "IN_MEDIATION" }));
    vi.spyOn(api, "lawyerBoard").mockResolvedValue([...mediation, ...page("a", 45)]);
    board();
    await screen.findByText("Caso a0");
    expect(screen.queryByRole("button", MORE)).not.toBeInTheDocument();
  });

  it("appends, dedupes by id, focuses, announces and hides the button on a short page", async () => {
    const next = [make("a49"), make("b0"), make("b1")];
    const spy = vi
      .spyOn(api, "lawyerBoard")
      .mockResolvedValueOnce(page("a", 50))
      .mockResolvedValueOnce(next);
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    expect(spy).toHaveBeenLastCalledWith({ limit: 50, offset: 50 });
    const first = await screen.findByText("Caso b0");
    expect(screen.getAllByText("Caso a49")).toHaveLength(1);
    expect(first).toHaveFocus();
    expect(screen.getByText("2 oportunidades carregadas.").closest("[role=status]")).not.toBeNull();
    expect(screen.queryByRole("button", MORE)).not.toBeInTheDocument();
  });

  it("keeps the button after a full page and pages on from the loaded count", async () => {
    const spy = vi
      .spyOn(api, "lawyerBoard")
      .mockResolvedValueOnce(page("a", 50))
      .mockResolvedValueOnce(page("b", 50))
      .mockResolvedValueOnce([]);
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    await screen.findByText("Caso b49");
    await user.click(screen.getByRole("button", MORE));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ limit: 50, offset: 100 }));
    await waitFor(() => expect(screen.queryByRole("button", MORE)).not.toBeInTheDocument());
  });

  it("disables the button while loading (single flight)", async () => {
    const d = deferred<CaseForLawyer[]>();
    const spy = vi.spyOn(api, "lawyerBoard").mockResolvedValueOnce(page("a", 50)).mockReturnValueOnce(d.promise);
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    const button = screen.getByRole("button", MORE);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(spy).toHaveBeenCalledTimes(2);
    d.resolve([make("b0")]);
    await screen.findByText("Caso b0");
  });

  it("shows an alert on failure and keeps the cards and the button", async () => {
    vi.spyOn(api, "lawyerBoard")
      .mockResolvedValueOnce(page("a", 50))
      .mockRejectedValueOnce(new ApiError(500, "Falha ao carregar mais."));
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao carregar mais.");
    expect(screen.getByText("Caso a0")).toBeInTheDocument();
    expect(screen.getByRole("button", MORE)).toBeEnabled();
  });

  it("ignores a load-more response that arrives after a reload from offset 0", async () => {
    const more = deferred<CaseForLawyer[]>();
    const reload = deferred<CaseForLawyer[]>();
    vi.spyOn(api, "lawyerBoard")
      .mockResolvedValueOnce(page("a", 50))
      .mockReturnValueOnce(more.promise)
      .mockReturnValueOnce(reload.promise);
    vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["ALUGUEL"] });
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    await user.click(await screen.findByRole("checkbox", { name: "Aluguel" }));
    await waitFor(() => expect(api.lawyerBoard).toHaveBeenCalledTimes(3));
    reload.resolve(page("r", 2));
    await screen.findByText("Caso r0");
    await act(async () => {
      more.resolve([make("late0")]);
      await more.promise;
    });
    expect(screen.queryByText("Caso late0")).not.toBeInTheDocument();
    expect(screen.queryByText("Caso a0")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", MORE)).not.toBeInTheDocument();
  });

  it("re-enables the button when a reload fails while a load-more is pending", async () => {
    const more = deferred<CaseForLawyer[]>();
    vi.spyOn(api, "lawyerBoard")
      .mockResolvedValueOnce(page("a", 50))
      .mockReturnValueOnce(more.promise)
      .mockRejectedValueOnce(new ApiError(500, "Falha."));
    vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["ALUGUEL"] });
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    await user.click(await screen.findByRole("checkbox", { name: "Aluguel" }));
    await waitFor(() => expect(api.lawyerBoard).toHaveBeenCalledTimes(3));
    await act(async () => {
      more.resolve([make("late0")]);
      await more.promise;
    });
    await waitFor(() => expect(screen.getByRole("button", MORE)).toBeEnabled());
    expect(screen.getByText("Caso a0")).toBeInTheDocument();
    expect(screen.queryByText("Caso late0")).not.toBeInTheDocument();
  });

  it("disables the button while a reload is pending", async () => {
    const reload = deferred<CaseForLawyer[]>();
    vi.spyOn(api, "lawyerBoard").mockResolvedValueOnce(page("a", 50)).mockReturnValueOnce(reload.promise);
    vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["ALUGUEL"] });
    board();
    const user = userEvent.setup();
    await screen.findByRole("button", MORE);
    await user.click(await screen.findByRole("checkbox", { name: "Aluguel" }));
    await waitFor(() => expect(api.lawyerBoard).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", MORE)).toBeDisabled();
    reload.resolve(page("r", 50));
    await screen.findByText("Caso r0");
    await waitFor(() => expect(screen.getByRole("button", MORE)).toBeEnabled());
  });

  it("announces when a page adds no new card and keeps focus off the heading", async () => {
    vi.spyOn(api, "lawyerBoard").mockResolvedValueOnce(page("a", 50)).mockResolvedValueOnce([make("a0")]);
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    await screen.findByText("Nenhuma nova oportunidade.");
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();
  });

  it("a 409 refetch after page 2 collapses to page 1 and the button reappears", async () => {
    vi.spyOn(api, "lawyerBoard")
      .mockResolvedValueOnce(page("a", 50))
      .mockResolvedValueOnce(page("b", 50))
      .mockResolvedValueOnce(page("c", 50));
    vi.spyOn(api, "matchCase").mockRejectedValue(new ApiError(409, "Conflito."));
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    await screen.findByText("Caso b0");
    await user.click(screen.getByText("Caso b0").closest("li")!.querySelector("button")!);
    await screen.findByText("Caso c0");
    expect(screen.queryByText("Caso b0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", MORE)).toBeEnabled();
  });

  it("a reload from offset 0 replaces the list and resets paging", async () => {
    const spy = vi
      .spyOn(api, "lawyerBoard")
      .mockResolvedValueOnce(page("a", 50))
      .mockResolvedValueOnce(page("b", 50))
      .mockResolvedValueOnce(page("r", 50))
      .mockResolvedValueOnce([make("x0")]);
    vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["ALUGUEL"] });
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    await screen.findByText("Caso b0");
    await user.click(screen.getByRole("checkbox", { name: "Aluguel" }));
    await screen.findByText("Caso r0");
    expect(screen.queryByText("Caso a0")).not.toBeInTheDocument();
    expect(screen.queryByText("Caso b0")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", MORE));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ limit: 50, offset: 50 }));
  });

  it("keeps mutations working on loaded cards", async () => {
    vi.spyOn(api, "lawyerBoard").mockResolvedValueOnce(page("a", 50)).mockResolvedValueOnce([make("b0")]);
    vi.spyOn(api, "matchCase").mockResolvedValue(make("b0", { status: "IN_MEDIATION" }));
    board();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", MORE));
    await screen.findByText("Caso b0");
    const heading = screen.getByText("Caso b0");
    await user.click(heading.closest("li")!.querySelector("button")!);
    await waitFor(() => expect(api.matchCase).toHaveBeenCalledWith("b0"));
  });
});
