"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  X,
  Phone,
  Loader2,
  MapPin,
  Info,
  Mic,
  Square,
  Volume2,
  RotateCcw,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  Mail,
  ExternalLink,
  PhoneCall,
  Clock,
  Radio,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGeolocation } from "@/lib/location";

export type EmergencyState =
  | "idle"
  | "countdown"
  | "sending"
  | "sent"
  | "cancelled"
  | "error";

interface Props {
  userName?: string;
  destination?: string;
  routeName?: string;
  onClose?: () => void;
}

interface AlertResponse {
  email_sent?: boolean;
  sms_sent?: boolean;
  sms_simulated?: boolean;
  email_error?: string | null;
  sms_error?: string | null;
  error?: string;
  map_link?: string;
  location_available?: boolean;
  voice_attached?: boolean;
  voice_error?: string | null;
  call_initiated?: boolean;
  call_sid?: string | null;
  call_status?: string | null;
  call_error?: string | null;
  call_announcement_type?: string | null;
}

const COUNTDOWN_SEC = 60;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5MB limit
const STORAGE_KEY_EMAIL = "suraksha_emergency_contact_email";
const STORAGE_KEY_PHONE = "suraksha_emergency_contact_phone";

function formatRecordingTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result;
      if (typeof res === "string") {
        resolve(res);
      } else {
        reject(new Error("Failed to convert audio blob to base64"));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

export function EmergencyAlert({
  userName = "App User",
  destination,
  routeName,
  onClose,
}: Props) {
  const emailInputId = useId();
  const phoneInputId = useId();

  const [phase, setPhase] = useState<EmergencyState>("idle");
  const [remaining, setRemaining] = useState(COUNTDOWN_SEC);
  const [result, setResult] = useState<AlertResponse | null>(null);
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendingRef = useRef(false);

  const { coords: geoCoords, isLoading: isGeoLoading } = useGeolocation({
    autoRequest: true,
  });

  // Restore saved contact details from localStorage on mount
  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem(STORAGE_KEY_EMAIL);
      const savedPhone = localStorage.getItem(STORAGE_KEY_PHONE);
      if (savedEmail) setContactEmail(savedEmail);
      if (savedPhone) setContactPhone(savedPhone);
    } catch {
      // ignore localStorage security errors
    }
  }, []);

  // Save contacts on change
  const handleEmailChange = (val: string) => {
    setContactEmail(val);
    try {
      localStorage.setItem(STORAGE_KEY_EMAIL, val.trim());
    } catch {
      // ignore
    }
  };

  const handlePhoneChange = (val: string) => {
    setContactPhone(val);
    try {
      localStorage.setItem(STORAGE_KEY_PHONE, val.trim());
    } catch {
      // ignore
    }
  };

  const clearCountdown = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stopMediaTracks = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      mediaStreamRef.current = null;
    }
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const cleanupAudioUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const discardRecording = useCallback(() => {
    clearRecordingTimer();
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    stopMediaTracks();
    cleanupAudioUrl();
    setAudioBlob(null);
    setAudioUrl(null);
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordingError(null);
  }, [clearRecordingTimer, stopMediaTracks, cleanupAudioUrl]);

  const startRecording = useCallback(async () => {
    setRecordingError(null);
    discardRecording();

    if (
      typeof window === "undefined" ||
      !navigator?.mediaDevices?.getUserMedia ||
      typeof window.MediaRecorder === "undefined"
    ) {
      setRecordingError("Audio recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/mp4",
        "audio/aac",
      ];
      let selectedMime = "";
      for (const mime of preferredTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
          selectedMime = mime;
          break;
        }
      }

      const recorder = selectedMime
        ? new MediaRecorder(stream, { mimeType: selectedMime })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stopMediaTracks();
        clearRecordingTimer();
        setIsRecording(false);

        const chunks = audioChunksRef.current;
        const mime = recorder.mimeType || selectedMime || "audio/webm";
        const blob = new Blob(chunks, { type: mime });

        if (blob.size === 0) {
          setRecordingError(
            "Recording was empty. Please check your microphone and speak."
          );
          return;
        }

        if (blob.size > MAX_AUDIO_BYTES) {
          setRecordingError(
            "Recording exceeds the 5MB upload limit. Please record a shorter message."
          );
          return;
        }

        const newUrl = URL.createObjectURL(blob);
        cleanupAudioUrl();
        audioUrlRef.current = newUrl;
        setAudioBlob(blob);
        setAudioUrl(newUrl);
      };

      recorder.onerror = () => {
        stopMediaTracks();
        clearRecordingTimer();
        setIsRecording(false);
        setRecordingError("An error occurred during audio recording.");
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);

      const startTime = Date.now();
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordingSeconds(elapsed);
        if (elapsed >= 60) {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }
      }, 1000);
    } catch (err: unknown) {
      stopMediaTracks();
      clearRecordingTimer();
      setIsRecording(false);

      if (err instanceof DOMException) {
        if (
          err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError"
        ) {
          setRecordingError(
            "Microphone permission denied. Grant permission in your browser or proceed without audio."
          );
        } else if (
          err.name === "NotFoundError" ||
          err.name === "DevicesNotFoundError"
        ) {
          setRecordingError("No microphone found on your device.");
        } else {
          setRecordingError(`Could not access microphone: ${err.message}`);
        }
      } else {
        setRecordingError(
          "Could not access microphone. You can still trigger the alert without audio."
        );
      }
    }
  }, [discardRecording, stopMediaTracks, clearRecordingTimer, cleanupAudioUrl]);

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
    clearRecordingTimer();
    stopMediaTracks();
  }, [clearRecordingTimer, stopMediaTracks]);

  const sendAlert = useCallback(async () => {
    // Prevent duplicate requests from countdown and Send Now button
    if (sendingRef.current) return;

    sendingRef.current = true;
    clearCountdown();
    setPhase("sending");
    setResult(null);

    try {
      let voiceB64: string | undefined;
      let voiceMime: string | undefined;
      let voiceFilename: string | undefined;

      if (audioBlob) {
        try {
          voiceB64 = await blobToBase64(audioBlob);
          voiceMime = audioBlob.type || "audio/webm";
          const ext =
            voiceMime.includes("mp4") || voiceMime.includes("aac")
              ? ".m4a"
              : voiceMime.includes("ogg")
                ? ".ogg"
                : voiceMime.includes("wav")
                  ? ".wav"
                  : ".webm";
          voiceFilename = `emergency_voice_message${ext}`;
        } catch (encodeErr) {
          console.error("Failed to encode audio attachment:", encodeErr);
        }
      }

      const activeIdempotencyKey =
        idempotencyKey || `sos_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      if (!idempotencyKey) {
        setIdempotencyKey(activeIdempotencyKey);
      }

      const body = {
        user_name: userName,
        latitude: geoCoords?.latitude,
        longitude: geoCoords?.longitude,
        destination,
        route_name: routeName,
        emergency_contact_email: contactEmail.trim() || undefined,
        emergency_contact_phone: contactPhone.trim() || undefined,
        voice_message_base64: voiceB64,
        voice_message_mime_type: voiceMime,
        voice_message_filename: voiceFilename,
        idempotency_key: activeIdempotencyKey,
      };

      const response = await fetch("/api/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let data: AlertResponse;
      try {
        data = (await response.json()) as AlertResponse;
      } catch {
        throw new Error(
          `The alert service returned an invalid response (HTTP ${response.status}).`
        );
      }

      setResult(data);

      // Distinguish honest outcomes:
      // If at least one primary channel (Email or Exotel Call) succeeded, show sent phase.
      // If both channels failed or returned errors, transition to error phase.
      if (response.ok && (data.email_sent === true || data.call_initiated === true)) {
        setPhase("sent");
      } else {
        setPhase("error");
      }
    } catch (error) {
      setResult({
        error:
          error instanceof Error
            ? error.message
            : "Network error. The alert status could not be confirmed.",
      });
      setPhase("error");
    } finally {
      sendingRef.current = false;
    }
  }, [
    clearCountdown,
    userName,
    geoCoords,
    destination,
    routeName,
    contactEmail,
    contactPhone,
    audioBlob,
    idempotencyKey,
  ]);

  useEffect(() => {
    if (phase !== "countdown") return;

    intervalRef.current = setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);

    return clearCountdown;
  }, [phase, clearCountdown]);

  useEffect(() => {
    if (phase === "countdown" && remaining === 0) {
      void sendAlert();
    }
  }, [phase, remaining, sendAlert]);

  useEffect(() => {
    return () => {
      clearCountdown();
      clearRecordingTimer();
      stopMediaTracks();
      cleanupAudioUrl();
    };
  }, [clearCountdown, clearRecordingTimer, stopMediaTracks, cleanupAudioUrl]);

  function startCountdown() {
    if (isRecording) {
      stopRecording();
    }
    setResult(null);
    setRemaining(COUNTDOWN_SEC);
    setIdempotencyKey(`sos_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
    setPhase("countdown");
  }

  function cancel() {
    clearCountdown();
    stopRecording();
    discardRecording();
    setRemaining(COUNTDOWN_SEC);
    setPhase("cancelled");
  }

  function handleClose() {
    clearCountdown();
    stopRecording();
    discardRecording();
    if (onClose) {
      onClose();
    }
  }

  function sendNow() {
    clearCountdown();
    if (isRecording) {
      stopRecording();
    }
    void sendAlert();
  }

  function resetToIdle() {
    clearCountdown();
    stopRecording();
    setPhase("idle");
    setRemaining(COUNTDOWN_SEC);
    setResult(null);
  }

  const circumference = 2 * Math.PI * 42;
  const strokeDashoffset = circumference - (remaining / COUNTDOWN_SEC) * circumference;

  const errorMessage =
    result?.error ||
    result?.email_error ||
    result?.call_error ||
    "The emergency alert could not be dispatched. Please verify contact information and backend settings.";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/65 backdrop-blur-sm p-3.5 sm:p-6 overflow-y-auto animate-rise"
    >
      <Card className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-white shadow-sheet my-auto">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-line/80 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl",
                phase === "countdown"
                  ? "bg-amber-100 text-amber-700"
                  : phase === "sent"
                    ? "bg-safer/15 text-safer"
                    : phase === "cancelled"
                      ? "bg-surface text-muted"
                      : "bg-red-100 text-concern"
              )}
            >
              {phase === "sent" ? (
                <ShieldCheck className="h-5 w-5" />
              ) : phase === "cancelled" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <ShieldAlert className="h-5 w-5" />
              )}
            </div>
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-wider text-muted">
                Suraksha Grid Emergency
              </span>
              <h2
                id="emergency-modal-title"
                className="text-base sm:text-lg font-bold text-ink"
              >
                {phase === "idle" && "Emergency Safety Alert"}
                {phase === "countdown" && "SOS Countdown Active"}
                {phase === "sending" && "Dispatching Emergency Alert…"}
                {phase === "sent" && "Alert Dispatched"}
                {phase === "cancelled" && "Alert Cancelled"}
                {phase === "error" && "Dispatch Incomplete"}
              </h2>
            </div>
          </div>

          {phase !== "countdown" && phase !== "sending" && (
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close emergency modal"
              className="rounded-xl p-2 text-muted hover:bg-surface hover:text-ink transition-colors focus-visible:outline-brand"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Phase 1: IDLE / CONFIGURATION */}
          {phase === "idle" && (
            <>
              <p className="text-xs sm:text-sm text-muted leading-relaxed">
                Starting this alert begins an automatic <b>60-second countdown</b>.
                Your trusted contact will receive an emergency email with your live
                map location and an automated outbound voice call. You can cancel anytime
                if you are safe.
              </p>

              {/* Step 1: Trusted Contacts */}
              <div className="rounded-xl border border-line bg-surface/60 p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-brand" />
                    Trusted Emergency Contacts
                  </span>
                  <span className="text-[11px] text-muted">Configurable</span>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor={emailInputId}
                    className="block text-xs font-semibold text-ink"
                  >
                    Emergency Contact Email
                  </label>
                  <p className="text-[11px] text-muted">
                    Receives live Google Maps location coordinates link and voice note.
                  </p>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted pointer-events-none" />
                    <input
                      id={emailInputId}
                      type="email"
                      value={contactEmail}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      placeholder="guardian@example.com"
                      autoComplete="email"
                      className="h-10 w-full rounded-xl border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted/60 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                    />
                  </div>
                </div>

                <div className="space-y-1 pt-1">
                  <label
                    htmlFor={phoneInputId}
                    className="block text-xs font-semibold text-ink"
                  >
                    Emergency Contact Phone (for Exotel Voice Call)
                  </label>
                  <p className="text-[11px] text-muted">
                    Receives an automated outbound SOS voice call announcement.
                  </p>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 h-4 w-4 text-muted pointer-events-none" />
                    <input
                      id={phoneInputId}
                      type="tel"
                      value={contactPhone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      placeholder="+91 98765 43210"
                      autoComplete="tel"
                      className="h-10 w-full rounded-xl border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted/60 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                    />
                  </div>
                </div>
              </div>

              {/* Step 2: Live Location Status Card */}
              <div className="rounded-xl border border-line bg-surface/40 p-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-lg",
                      geoCoords
                        ? "bg-safer/15 text-safer"
                        : isGeoLoading
                          ? "bg-brand/10 text-brand"
                          : "bg-amber-100 text-amber-700"
                    )}
                  >
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-ink block">
                      {geoCoords
                        ? "GPS Location Captured"
                        : isGeoLoading
                          ? "Acquiring Device GPS…"
                          : "GPS Coordinates Unavailable"}
                    </span>
                    <span className="text-[11px] text-muted">
                      {geoCoords ? (
                        `${geoCoords.latitude.toFixed(5)}, ${geoCoords.longitude.toFixed(5)}`
                      ) : isGeoLoading ? (
                        "Requesting browser permission…"
                      ) : (
                        "Alert will state 'Location unavailable' honestly"
                      )}
                    </span>
                  </div>
                </div>
                {geoCoords && (
                  <span className="rounded-full bg-safer/15 px-2 py-0.5 text-[10px] font-bold text-safer">
                    Ready
                  </span>
                )}
                {isGeoLoading && (
                  <Loader2 className="h-4 w-4 animate-spin text-brand" />
                )}
              </div>

              {/* Step 3: Voice Message Section */}
              <div className="rounded-xl border border-line bg-surface/60 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
                    <Mic className="h-3.5 w-3.5 text-brand" />
                    Recorded Voice Note (Optional)
                  </span>
                  {audioBlob && (
                    <span className="text-[11px] font-semibold text-brand">
                      {(audioBlob.size / 1024).toFixed(0)} KB attached
                    </span>
                  )}
                </div>

                {!isRecording && !audioBlob && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-center gap-2 border-line bg-white text-xs font-semibold text-ink hover:border-brand hover:bg-surface"
                    onClick={() => void startRecording()}
                  >
                    <Mic className="h-3.5 w-3.5 text-concern" />
                    Record audio message (max 60s)
                  </Button>
                )}

                {isRecording && (
                  <div className="flex items-center justify-between rounded-xl border border-red-300 bg-red-50/80 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-3 w-3">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-concern opacity-75" />
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-concern" />
                      </span>
                      <span className="text-xs font-semibold text-concern">
                        Recording message… {formatRecordingTime(recordingSeconds)} / 01:00
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 bg-concern px-3 text-xs font-semibold text-white hover:bg-concern/90"
                      onClick={stopRecording}
                    >
                      <Square className="mr-1 h-3 w-3 fill-current" />
                      Stop
                    </Button>
                  </div>
                )}

                {audioBlob && audioUrl && (
                  <div className="space-y-2 rounded-xl border border-line bg-white p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                        <Volume2 className="h-3.5 w-3.5 text-brand" />
                        Voice Preview
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void startRecording()}
                          title="Re-record voice note"
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted hover:bg-surface hover:text-ink transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Re-record
                        </button>
                        <button
                          type="button"
                          onClick={discardRecording}
                          title="Remove voice note"
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-concern hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </button>
                      </div>
                    </div>
                    <audio
                      controls
                      src={audioUrl}
                      className="h-8 w-full rounded-md"
                      preload="metadata"
                    />
                  </div>
                )}

                {recordingError && (
                  <p className="flex items-start gap-1 text-[11px] text-concern">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{recordingError}</span>
                  </p>
                )}
              </div>

              {/* Demo Mode / Policy Note */}
              <div className="flex items-start gap-2 rounded-xl bg-surface p-2.5 text-[11px] text-muted border border-line/60">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                <span>
                  Resend handles emergency location emails; Exotel delivers the automated
                  SOS voice call. SMS is simulated in demo mode.
                </span>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="sm:w-1/3 order-2 sm:order-1 rounded-xl text-ink"
                  onClick={handleClose}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  className="sm:w-2/3 order-1 sm:order-2 rounded-xl bg-concern text-white font-bold hover:bg-concern/90 shadow-sm"
                  onClick={startCountdown}
                >
                  <Phone className="mr-2 h-4 w-4" />
                  Start 60s Emergency Alert
                </Button>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={sendNow}
                  className="text-xs font-semibold text-concern hover:underline underline-offset-4"
                >
                  In immediate danger? Send alert right now without waiting
                </button>
              </div>
            </>
          )}

          {/* Phase 2: 60-SECOND COUNTDOWN */}
          {phase === "countdown" && (
            <div className="flex flex-col items-center gap-4 py-2">
              {/* Radial Countdown Indicator */}
              <div className="relative flex items-center justify-center">
                <svg
                  width="110"
                  height="110"
                  viewBox="0 0 100 100"
                  className="-rotate-90"
                  aria-label={`${remaining} seconds remaining`}
                >
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="#E3E8EF"
                    strokeWidth="7"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="#EA580C"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    style={{ transition: "stroke-dashoffset 1s linear" }}
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-3xl font-extrabold text-ink">{remaining}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    sec
                  </span>
                </div>
              </div>

              <div className="text-center space-y-1">
                <h3 className="text-sm sm:text-base font-bold text-ink">
                  Emergency alert will dispatch automatically
                </h3>
                <p className="text-xs text-muted max-w-sm">
                  If you are safe, cancel below before the countdown finishes.
                </p>
              </div>

              {/* Queued payload recap */}
              <div className="w-full rounded-xl border border-line bg-surface/60 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-muted">
                  <span>Recipient Email:</span>
                  <span className="font-semibold text-ink">
                    {contactEmail.trim() || "(None configured)"}
                  </span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Recipient Phone:</span>
                  <span className="font-semibold text-ink">
                    {contactPhone.trim() || "(None configured)"}
                  </span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>GPS Location:</span>
                  <span className="font-semibold text-ink">
                    {geoCoords
                      ? `${geoCoords.latitude.toFixed(4)}, ${geoCoords.longitude.toFixed(4)}`
                      : "Unavailable"}
                  </span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Voice Note:</span>
                  <span className="font-semibold text-ink">
                    {audioBlob ? `${(audioBlob.size / 1024).toFixed(0)} KB attached` : "None"}
                  </span>
                </div>
              </div>

              {/* Cancellation & Immediate Actions */}
              <div className="w-full space-y-2 pt-1">
                <Button
                  type="button"
                  className="w-full rounded-xl bg-safer hover:bg-safer/90 text-white font-bold py-3 text-sm shadow-md"
                  onClick={cancel}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  I'm Safe — Cancel Alert
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full rounded-xl border-line text-xs font-semibold text-concern hover:bg-red-50 hover:border-red-200"
                  onClick={sendNow}
                >
                  Send Now Immediately
                </Button>
              </div>
            </div>
          )}

          {/* Phase 3: DISPATCHING / SENDING */}
          {phase === "sending" && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-concern" />
              <div className="space-y-1">
                <h3 className="text-base font-bold text-ink">Dispatching SOS Alert</h3>
                <p className="text-xs text-muted max-w-xs">
                  Connecting to emergency providers, transmitting location, and initiating
                  outbound voice call…
                </p>
              </div>
            </div>
          )}

          {/* Phase 4: SENT (Breakdown of Channels) */}
          {phase === "sent" && result && (
            <div className="space-y-3.5">
              <div className="rounded-xl border border-safer/30 bg-safer/10 p-3 text-xs text-safer font-medium flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safer" />
                <span>
                  Emergency alert request accepted. Detailed provider dispatch statuses are
                  listed below.
                </span>
              </div>

              {/* Status Breakdown List */}
              <div className="space-y-2 text-xs">
                {/* 1. Location Status */}
                <div className="rounded-xl border border-line p-3 flex items-start justify-between bg-surface/40">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                    <div>
                      <span className="font-bold text-ink block">Location Status</span>
                      <span className="text-[11px] text-muted">
                        {result.location_available
                          ? "Accurate GPS coordinates included in alert."
                          : "GPS coordinates were unavailable at the time of alert."}
                      </span>
                    </div>
                  </div>
                  {result.map_link && (
                    <a
                      href={result.map_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 font-semibold text-brand hover:underline"
                    >
                      <span>Map</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {/* 2. Email Delivery */}
                <div className="rounded-xl border border-line p-3 flex items-start gap-2 bg-surface/40">
                  {result.email_sent ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safer" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <div>
                    <span className="font-bold text-ink block">
                      Emergency Email (Resend)
                    </span>
                    <span className="text-[11px] text-muted block">
                      {result.email_sent
                        ? "Accepted by email provider. (Note: Provider acceptance is confirmed; inbox receipt depends on recipient email server filters)."
                        : `Email failed: ${result.email_error || "Could not deliver email"}`}
                    </span>
                  </div>
                </div>

                {/* 3. Exotel Voice Call */}
                <div className="rounded-xl border border-line p-3 flex items-start gap-2 bg-surface/40">
                  {result.call_initiated ? (
                    <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-safer" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  )}
                  <div>
                    <span className="font-bold text-ink block">
                      Outbound Voice Call (Exotel)
                    </span>
                    <span className="text-[11px] text-muted block">
                      {result.call_initiated ? (
                        <>
                          Automated call initiated (Status: {result.call_status || "queued"}
                          {result.call_sid ? `, Sid: ${result.call_sid.substring(0, 14)}…` : ""}).
                          Announcement:{" "}
                          {result.call_announcement_type === "location_email_sent"
                            ? "Confirmed location email announcement"
                            : "Generic emergency alert"}
                        </>
                      ) : (
                        result.call_error || "Voice calling not configured on server"
                      )}
                    </span>
                  </div>
                </div>

                {/* 4. Voice Recording */}
                {result.voice_attached && (
                  <div className="rounded-xl border border-line p-3 flex items-start gap-2 bg-surface/40">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safer" />
                    <div>
                      <span className="font-bold text-ink block">
                        Voice Message Note
                      </span>
                      <span className="text-[11px] text-muted">
                        Playable voice audio was attached and delivered with the emergency
                        email.
                      </span>
                    </div>
                  </div>
                )}

                {/* 5. SMS Simulator notice */}
                <div className="rounded-xl border border-line p-2.5 flex items-start gap-2 bg-surface/30 text-[11px] text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                  <span>Demo mode notice: SMS is simulated; no carrier SMS was sent.</span>
                </div>
              </div>

              {/* Direct Emergency Contact Reminder */}
              <div className="rounded-xl border border-red-200 bg-red-50/70 p-3 text-xs flex items-center justify-between">
                <div>
                  <span className="font-bold text-concern block">Need Immediate Police?</span>
                  <span className="text-[11px] text-muted">
                    Dial 112 directly for emergency services.
                  </span>
                </div>
                <a
                  href="tel:112"
                  className="rounded-lg bg-concern px-3 py-1.5 text-xs font-bold text-white hover:bg-concern/90"
                >
                  Call 112
                </a>
              </div>

              <div className="pt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-1/2 rounded-xl text-ink"
                  onClick={resetToIdle}
                >
                  Send Another
                </Button>
                <Button
                  type="button"
                  className="w-1/2 rounded-xl bg-ink text-white font-semibold"
                  onClick={handleClose}
                >
                  Close
                </Button>
              </div>
            </div>
          )}

          {/* Phase 5: CANCELLED */}
          {phase === "cancelled" && (
            <div className="py-6 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-safer/15 text-safer">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-ink">Alert Cancelled</h3>
                <p className="text-xs text-muted max-w-xs mx-auto">
                  No alerts or voice calls were dispatched. Stay safe!
                </p>
              </div>
              <Button
                type="button"
                className="w-full rounded-xl bg-ink text-white font-semibold"
                onClick={handleClose}
              >
                Close
              </Button>
            </div>
          )}

          {/* Phase 6: ERROR */}
          {phase === "error" && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-concern flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <span className="font-bold block">Dispatch Failed or Unconfirmed</span>
                  <span className="text-[11px] leading-relaxed block">{errorMessage}</span>
                </div>
              </div>

              {/* Status details if any available */}
              {result && (
                <div className="rounded-xl border border-line bg-surface/50 p-3 space-y-1.5 text-xs">
                  {result.email_error && (
                    <div className="text-muted">
                      <b>Email error:</b> {result.email_error}
                    </div>
                  )}
                  {result.call_error && (
                    <div className="text-muted">
                      <b>Voice call error:</b> {result.call_error}
                    </div>
                  )}
                  {result.sms_simulated && (
                    <div className="text-[11px] text-muted">
                      SMS remains simulated in demo mode.
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-red-200 bg-red-50/70 p-3 text-xs flex items-center justify-between">
                <div>
                  <span className="font-bold text-concern block">Dial Emergency Services</span>
                  <span className="text-[11px] text-muted">Direct phone line to 112.</span>
                </div>
                <a
                  href="tel:112"
                  className="rounded-lg bg-concern px-3 py-1.5 text-xs font-bold text-white hover:bg-concern/90"
                >
                  Call 112
                </a>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="w-1/2 rounded-xl text-ink"
                  onClick={handleClose}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  className="w-1/2 rounded-xl bg-concern text-white font-bold hover:bg-concern/90"
                  onClick={() => void sendAlert()}
                >
                  Retry Dispatch
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
