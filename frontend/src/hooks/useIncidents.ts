import { useEffect, useRef, useState } from "react";
import {
  fetchIncident,
  fetchIncidents,
  fetchOperator,
  IncidentRequestError,
  loginOperator,
  mutateIncident,
  type IncidentAction,
} from "../api/incidents";
import type {
  IncidentDetailData,
  IncidentSummary,
  Operator,
} from "../domain/incidents";

export function useIncidents() {
  const [incidents, setIncidents] = useState<IncidentSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IncidentDetailData | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [operator, setOperator] = useState<Operator | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [pending, setPending] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const actionController = useRef<AbortController | null>(null);
  const detailIdRef = useRef<string | null>(null);
  const refresh = () => {
    setRevision((value) => value + 1);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden && !actionController.current)
        setRevision((value) => value + 1);
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      actionController.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAuthLoading(true);
    void fetchOperator(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setOperator(value);
          setAuthError("");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setOperator(null);
          setAuthError(
            error instanceof IncidentRequestError && error.status === 401
              ? ""
              : "Could not verify your session. Sign in to retry.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    void fetchIncidents(offset, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setIncidents(value);
          setListError("");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setListError(
            error instanceof IncidentRequestError && error.status === 401
              ? "Incident access requires sign-in."
              : error instanceof IncidentRequestError && error.status === 403
                ? "You are not permitted to view incidents."
                : "Could not load incidents. Refresh to retry.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [offset, revision]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const initialLoad = detailIdRef.current !== selectedId;
    setDetailLoading(initialLoad);
    setDetailRefreshing(!initialLoad);
    void fetchIncident(selectedId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setDetail(value);
          detailIdRef.current = selectedId;
          setDetailError("");
          setNeedsRefresh(false);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setDetailError(
            error instanceof IncidentRequestError && error.status === 404
              ? "Incident no longer available. Select another incident."
              : "Could not load incident detail. Refresh to retry.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
          setDetailRefreshing(false);
        }
      });
    return () => controller.abort();
  }, [selectedId, revision]);

  async function login(identity: string, password: string) {
    if (actionController.current) return false;
    const controller = new AbortController();
    actionController.current = controller;
    setPending(true);
    setAuthError("");
    try {
      const value = await loginOperator(identity, password, controller.signal);
      if (controller.signal.aborted) return false;
      setOperator(value);
      refresh();
      return true;
    } catch (error) {
      if (!controller.signal.aborted)
        setAuthError(
          error instanceof IncidentRequestError && error.status === 401
            ? "Sign-in failed. Check your credentials."
            : "Sign-in unavailable. Try again.",
        );
      return false;
    } finally {
      if (!controller.signal.aborted) setPending(false);
      actionController.current = null;
    }
  }

  async function mutate(action: IncidentAction, value?: string) {
    if (
      !operator ||
      !detail ||
      actionController.current ||
      detailLoading ||
      detailError ||
      listError ||
      needsRefresh
    )
      return false;
    const controller = new AbortController();
    actionController.current = controller;
    setPending(true);
    setActionMessage("Saving incident…");
    setActionError(false);
    try {
      await mutateIncident(
        detail.incident.id,
        action,
        detail.incident.status,
        controller.signal,
        value,
      );
      if (controller.signal.aborted) return false;
      setActionMessage(
        action === "comments" ? "Comment added." : "Incident updated.",
      );
      setNeedsRefresh(true);
      refresh();
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        setActionError(true);
        if (error instanceof IncidentRequestError && error.status === 401) {
          setOperator(null);
          setActionMessage(
            "Session expired. Sign in to continue; your comment is retained.",
          );
        } else if (
          error instanceof IncidentRequestError &&
          error.status === 403
        ) {
          setActionMessage("Your account cannot change this incident.");
        } else {
          setNeedsRefresh(true);
          setActionMessage(
            error instanceof IncidentRequestError && error.status === 409
              ? "Incident changed. Refresh before trying again; your comment is retained."
              : "Save could not be confirmed. Refresh and check the timeline before trying again.",
          );
        }
      }
      return false;
    } finally {
      if (!controller.signal.aborted) setPending(false);
      actionController.current = null;
    }
  }

  return {
    incidents,
    selectedId,
    detail: detail?.incident.id === selectedId ? detail : null,
    offset,
    listLoading,
    listError,
    detailLoading,
    detailRefreshing,
    detailError,
    operator,
    authLoading,
    authError,
    pending,
    actionMessage,
    actionError,
    needsRefresh,
    refresh,
    login,
    mutate,
    select: (id: string) => {
      if (actionController.current) return;
      if (id === selectedId) return;
      setSelectedId(id);
      setDetailError("");
      setActionMessage("");
      setNeedsRefresh(false);
    },
    page: (next: number) => {
      if (actionController.current) return;
      setOffset(next);
      setIncidents(null);
    },
  };
}
