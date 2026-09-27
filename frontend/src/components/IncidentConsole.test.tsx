// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

vi.mock("../hooks/useTelemetrySocket", () => ({
  useTelemetrySocket: () => ({
    telemetry: null,
    connectionStatus: "connected",
  }),
}));
vi.mock("../hooks/useTelemetryHistory", () => ({
  useTelemetryHistory: () => ({
    series: [],
    isLoading: false,
    isFetching: false,
    hasError: false,
    isStale: false,
    retry: vi.fn(),
  }),
}));
vi.mock("./OrbitalScene", () => ({
  OrbitalScene: () => <section aria-label="Orbital instrument" />,
}));
vi.mock("./SystemDiagnostics", () => ({ SystemDiagnostics: () => null }));

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-09-17T10:00:00.000Z";
const user = {
  id: "33333333-3333-4333-8333-333333333333",
  username: "operator",
  role: "operator",
};
const incident = {
  id,
  incidentNumber: 1000,
  displayNumber: "INC-1000",
  spacecraftId: "ORBITAL-X1",
  title: "Fuel pressure anomaly",
  description: "Pressure below range",
  severity: "critical",
  status: "open",
  rootCause: null,
  affectedSubsystems: ["propulsion"],
  createdAt: timestamp,
  updatedAt: timestamp,
  acknowledgedAt: null,
  acknowledgedBy: null,
  resolvedAt: null,
  resolvedBy: null,
};
const event = {
  id: 1,
  incidentId: id,
  actorId: null,
  eventType: "created",
  description: "Incident created",
  metadata: null,
  timestamp,
};
const alert = {
  id: otherId,
  spacecraftId: "ORBITAL-X1",
  subsystem: "propulsion",
  severity: "critical",
  metric: "fuel_pressure",
  value: 1.2,
  expectedRange: "2.5–3.5 MPa",
  anomalyScore: 0.9,
  detectionMethod: "rule",
  fingerprint: "fingerprint",
  occurrenceCount: 2,
  status: "active",
  createdAt: timestamp,
  lastSeenAt: timestamp,
  updatedAt: timestamp,
  acknowledgedAt: null,
  acknowledgedBy: null,
  resolvedAt: null,
  resolvedBy: null,
};
const response = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: async () =>
      status < 400
        ? { success: true, data }
        : {
            success: false,
            error: { code: "ERROR", message: "Service unavailable" },
          },
  } as Response);
let current: typeof incident;
let timeline: (Omit<typeof event, "actorId"> & { actorId: string | null })[];
let fetchMock: ReturnType<typeof vi.fn>;
const baseFetch = (url: string, options?: RequestInit) => {
  if (
    url.endsWith("/auth/me") ||
    url.endsWith("/auth/login") ||
    url.endsWith("/auth/refresh")
  )
    return response(user);
  if (options?.method === "POST") {
    const body = JSON.parse(String(options.body));
    if (url.endsWith("/comments")) {
      const added = {
        ...event,
        id: 2,
        actorId: user.id,
        eventType: "commented",
        description: body.comment,
        timestamp: "2026-09-17T10:01:00.000Z",
      };
      timeline = [...timeline, added];
      return response(added);
    }
    current = {
      ...current,
      status: url.endsWith("/acknowledge")
        ? "acknowledged"
        : url.endsWith("/resolve")
          ? "resolved"
          : body.status,
    };
    return response(current);
  }
  if (url.includes(`/incidents/${id}`))
    return response({ incident: current, alerts: [alert], timeline });
  if (url.includes(`/incidents/${otherId}`))
    return response({
      incident: {
        ...incident,
        id: otherId,
        displayNumber: "INC-1001",
        incidentNumber: 1001,
        title: "Power anomaly",
      },
      alerts: [],
      timeline: [],
    });
  return response([
    { ...current, alertCount: 1 },
    {
      ...incident,
      id: otherId,
      displayNumber: "INC-1001",
      incidentNumber: 1001,
      title: "Power anomaly",
      alertCount: 0,
    },
  ]);
};
beforeEach(() => {
  current = { ...incident };
  timeline = [{ ...event }];
  fetchMock = vi.fn(baseFetch);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openIncident() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /INC-1000/ }));
  return screen.findByRole("region", { name: "Incident detail" });
}

describe("incident console", () => {
  it("distinguishes forbidden reads from unavailable storage", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("/incidents?") ? response(null, 403) : response(user),
    );
    render(<App />);
    expect(
      await screen.findByText(/not permitted to view incidents/i),
    ).toBeInTheDocument();
  });

  it("rejects ambiguous timestamps and wrong spacecraft data at the read boundary", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("/incidents?")
        ? response([{ ...incident, alertCount: 1, createdAt: "1" }])
        : response(user),
    );
    render(<App />);
    expect(
      await screen.findByText(/Could not load incidents/),
    ).toBeInTheDocument();
    fetchMock.mockImplementation((url: string) =>
      url.includes("/incidents?")
        ? response([{ ...incident, alertCount: 1, spacecraftId: "OTHER" }])
        : response(user),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh incidents" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh incidents" }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", { name: /INC-1000/ }),
    ).not.toBeInTheDocument();
  });

  it("bounds automatic refresh, stops polling while hidden and cancels requests on unmount", async () => {
    vi.useFakeTimers();
    const rendered = render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const initial = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(initial);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(initial + 1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(initial + 1);
    rendered.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(initial + 1);
  });

  it("times out stalled reads and leaves an explicit refresh path", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url: string, options?: RequestInit) =>
      url.includes("/incidents?")
        ? new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          })
        : response(user),
    );
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText(/Could not load incidents/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh incidents" }),
    ).toBeEnabled();
  });

  it("preserves a comment through selection and session expiry without replaying the mutation", async () => {
    const detail = await openIncident();
    fireEvent.change(within(detail).getByLabelText("Comment"), {
      target: { value: "Operator draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /INC-1001/ }));
    await screen.findByRole("heading", { name: /INC-1001/ });
    fireEvent.click(screen.getByRole("button", { name: /INC-1000/ }));
    await screen.findByRole("heading", { name: /INC-1000/ });
    expect(screen.getByLabelText("Comment")).toHaveValue("Operator draft");
    fetchMock.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? response(null, 401)
        : baseFetch(url, options),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    expect(await screen.findByText(/Session expired/)).toBeInTheDocument();
    expect(screen.getByLabelText("Comment")).toHaveValue("Operator draft");
    expect(screen.getByRole("button", { name: "Add comment" })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
  });

  it("exposes loading, a bounded cookie read and an honest empty state", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation((url: string) =>
      url.includes("/incidents?")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : response(user),
    );
    render(<App />);
    expect(
      screen.getByRole("status", { name: "Incident list status" }),
    ).toHaveTextContent(/Loading/);
    await act(async () => {
      finish(await response([]));
    });
    expect(
      await screen.findByText(/No incidents recorded/),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /incidents\?spacecraftId=ORBITAL-X1&limit=50&offset=0/,
      ),
      expect.objectContaining({
        credentials: "include",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("shows unavailable and malformed responses as errors instead of empty data", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("/incidents?")
        ? response([{ ...incident, severity: "unknown" }])
        : response(user),
    );
    render(<App />);
    expect(
      await screen.findByText(/Could not load incidents/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No incidents recorded/)).not.toBeInTheDocument();
    fetchMock.mockImplementation(baseFetch);
    fireEvent.click(screen.getByRole("button", { name: "Refresh incidents" }));
    expect(
      await screen.findByRole("button", { name: /INC-1000/ }),
    ).toBeInTheDocument();
  });

  it("allows read-only inspection when unauthenticated, validates sign-in and uses cookies", async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) =>
      url.endsWith("/auth/me") || url.endsWith("/auth/refresh")
        ? response(null, 401)
        : baseFetch(url, options),
    );
    const detail = await openIncident();
    expect(
      await screen.findByText(/Sign in to triage incidents/),
    ).toBeInTheDocument();
    expect(
      within(detail).getByRole("button", { name: "Acknowledge" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText("Username or email")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "operator" },
    });
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
      target: { value: "test-password" },
    });
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Signed in as operator"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login"),
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({
          username: "operator",
          password: "test-password",
        }),
      }),
    );
  });

  it("keeps telemetry selection while selecting incidents and renders chronological UTC evidence", async () => {
    timeline = [
      {
        ...event,
        id: 2,
        description: "<img src=x onerror=alert(1)>",
        timestamp: "2026-09-17T10:01:00.000Z",
      },
      event,
    ];
    const detail = await openIncident();
    const list = within(detail).getByRole("list", {
      name: "Incident timeline",
    });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(
      "Incident created",
    );
    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector("time")).toHaveAttribute("datetime", timestamp);
    expect(list).toHaveTextContent("UTC");
    expect(within(detail).getByText("Fuel pressure")).toBeInTheDocument();
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Spacecraft subsystems" }),
      ).getByRole("button", { name: /Power/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /INC-1001/ }));
    expect(
      await screen.findByRole("heading", { name: /INC-1001/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Power telemetry" }),
    ).toBeInTheDocument();
  });

  it("commits acknowledge, status, comment and resolve only after server confirmation", async () => {
    const detail = await openIncident();
    fireEvent.click(
      within(detail).getByRole("button", { name: "Acknowledge" }),
    );
    await waitFor(() =>
      expect(
        within(detail).getByText("Acknowledged", { selector: "strong" }),
      ).toBeInTheDocument(),
    );
    fireEvent.change(within(detail).getByLabelText("Incident status"), {
      target: { value: "investigating" },
    });
    fireEvent.click(
      within(detail).getByRole("button", { name: "Change status" }),
    );
    await waitFor(() =>
      expect(
        within(detail).getByText("Investigating", { selector: "strong" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      within(detail).getByRole("button", { name: "Add comment" }),
    );
    expect(within(detail).getByLabelText("Comment")).toHaveFocus();
    expect(within(detail).getByLabelText("Comment")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.change(within(detail).getByLabelText("Comment"), {
      target: { value: "  Observed <b>pressure</b>  " },
    });
    fireEvent.click(
      within(detail).getByRole("button", { name: "Add comment" }),
    );
    expect(
      await within(detail).findByText("Observed <b>pressure</b>"),
    ).toBeInTheDocument();
    expect(within(detail).getByLabelText("Comment")).toHaveValue("");
    fireEvent.click(within(detail).getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(
        within(detail).getByText("Resolved", { selector: "strong" }),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/resolve"),
      expect.objectContaining({
        body: JSON.stringify({ expectedStatus: "investigating" }),
      }),
    );
  });

  it("blocks duplicate mutations and preserves draft text after a conflict", async () => {
    const detail = await openIncident();
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : baseFetch(url, options),
    );
    fireEvent.change(within(detail).getByLabelText("Comment"), {
      target: { value: "Keep this draft" },
    });
    const button = within(detail).getByRole("button", { name: "Acknowledge" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(
      within(detail).getByText("Open", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
    await act(async () => {
      finish(await response(null, 409));
    });
    expect(await screen.findByText(/changed.*Refresh/i)).toBeInTheDocument();
    expect(within(detail).getByLabelText("Comment")).toHaveValue(
      "Keep this draft",
    );
  });

  it("keeps a conflicted incident blocked when reselected", async () => {
    const detail = await openIncident();
    fetchMock.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? response(null, 409)
        : baseFetch(url, options),
    );
    fireEvent.click(
      within(detail).getByRole("button", { name: "Acknowledge" }),
    );
    expect(await screen.findByText(/changed.*Refresh/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /INC-1000/ }));
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeDisabled();
    expect(screen.getByText(/changed.*Refresh/i)).toBeInTheDocument();
  });

  it("does not drop comment focus during background detail refresh", async () => {
    const detail = await openIncident();
    vi.useFakeTimers();
    const comment = within(detail).getByLabelText("Comment");
    comment.focus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(comment).toHaveFocus();
    expect(comment).toBeEnabled();
  });

  it("aborts superseded detail requests and ignores late responses", async () => {
    let finish!: (value: Response) => void;
    let signal: AbortSignal | null | undefined;
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes(`/incidents/${id}`)) {
        signal = options?.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return baseFetch(url, options);
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /INC-1000/ }));
    fireEvent.click(screen.getByRole("button", { name: /INC-1001/ }));
    expect(
      await screen.findByRole("heading", { name: /INC-1001/ }),
    ).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish(await response({ incident, alerts: [], timeline: [] }));
    });
    expect(
      screen.queryByRole("heading", { name: /INC-1000/ }),
    ).not.toBeInTheDocument();
  });

  it("retains and labels stale data on refresh failure, without automatic rapid retry", async () => {
    await openIncident();
    fetchMock.mockImplementation((url: string, options?: RequestInit) =>
      url.includes("/incidents")
        ? response(null, 503)
        : baseFetch(url, options),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh incidents" }));
    expect(
      await screen.findByText(/Showing retained incidents/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /INC-1000/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeDisabled();
    const count = fetchMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });
});
