"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FaceCapture from "@/components/FaceCapture";
import { detectFaceDeviceClass } from "@/lib/face-device";
import type {
  FaceCapturePayload,
  FaceChallengeMode,
  FaceDeviceClass,
  FaceTemplateRole
} from "@/lib/face-types";

type GateProfile = {
  mode: Exclude<FaceChallengeMode, "register">;
  templateRole: FaceTemplateRole;
};

export default function FaceGate({
  desktopPrimaryEnrolled,
  mobilePrimaryEnrolled,
  canonicalEnrolled
}: {
  desktopPrimaryEnrolled: boolean;
  mobilePrimaryEnrolled: boolean;
  canonicalEnrolled: boolean;
}) {
  const router = useRouter();
  const [deviceClass, setDeviceClass] = useState<FaceDeviceClass | null>(null);
  const [profile, setProfile] = useState<GateProfile | null>(null);
  const [blocked, setBlocked] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const detected = detectFaceDeviceClass();
      setDeviceClass(detected);
      if (detected === "mobile") {
        if (mobilePrimaryEnrolled) setProfile({ mode: "verify", templateRole: "mobile-primary" });
        else if (canonicalEnrolled) setProfile({ mode: "verify", templateRole: "canonical-cross-device" });
        else if (desktopPrimaryEnrolled) {
          setBlocked("Akun ini hanya memiliki template desktop lama dan belum mempunyai template lintas perangkat.");
        } else setProfile({ mode: "enroll", templateRole: "canonical-cross-device" });
        return;
      }

      if (desktopPrimaryEnrolled) setProfile({ mode: "verify", templateRole: "desktop-primary" });
      else if (canonicalEnrolled) setProfile({ mode: "verify", templateRole: "canonical-cross-device" });
      else if (mobilePrimaryEnrolled) {
        setBlocked("Akun ini hanya memiliki template HP lama dan belum mempunyai template lintas perangkat.");
      } else setProfile({ mode: "enroll", templateRole: "canonical-cross-device" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canonicalEnrolled, desktopPrimaryEnrolled, mobilePrimaryEnrolled]);

  async function complete(payload: FaceCapturePayload) {
    if (!profile) return;
    const response = await fetch(`/api/face/${profile.mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({
      ok: false,
      message: `Server mengembalikan respons yang tidak valid (${response.status}).`
    })) as {
      ok: boolean;
      message?: string;
    };
    if (!response.ok) throw new Error(result.message || "Verifikasi wajah gagal.");
    router.refresh();
  }

  const existingTemplate = profile?.mode === "verify";

  return (
    <section className="face-gate app-card card-pad">
      <div className="face-gate-heading">
        <span className="face-gate-icon"><i className="bx bx-face" /></span>
        <div>
          <span className="eyebrow">Pemeriksaan Keamanan Satu Kali</span>
          <h2>{existingTemplate ? "Verifikasi Wajah untuk Membuka Bilik Suara" : "Aktivasi Verifikasi Wajah"}</h2>
          <p>
            {existingTemplate
              ? "Selesaikan pemeriksaan liveness. Sistem hanya mencocokkan satu template yang sesuai dengan profil perangkat ini."
              : "Selesaikan satu kali liveness untuk mengaktifkan template wajah akun ini."}
          </p>
        </div>
      </div>
      {!deviceClass && <div className="alert alert-info">Mendeteksi profil perangkat…</div>}
      {blocked && <div className="alert alert-warning" role="alert">{blocked}</div>}
      {deviceClass && profile && (
        <FaceCapture
          key={`${profile.mode}-${profile.templateRole}`}
          mode={profile.mode}
          templateRole={profile.templateRole}
          deviceClass={deviceClass}
          onComplete={complete}
          compact
        />
      )}
      <div className="face-privacy-note"><i className="bx bx-lock-alt" /> Descriptor wajah disimpan terenkripsi; foto atau rekaman kamera tidak diunggah dan tidak disimpan.</div>
    </section>
  );
}
