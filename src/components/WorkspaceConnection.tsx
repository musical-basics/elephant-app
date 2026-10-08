import { useEffect, useRef, useState } from "react";
import { Copy, LoaderCircle, Smartphone } from "lucide-react";
import Sheet from "./Sheet";
import {
  connectExistingWorkspace,
  privateWorkspaceLink,
} from "../lib/workspaceConnection";
import "./WorkspaceConnection.css";

export function ConnectAnotherDevice({
  connectionKey,
}: {
  connectionKey: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="secondary-button connect-device-button"
        onClick={() => setOpen(true)}
      >
        <Smartphone size={18} />
        Connect another device
      </button>
      {open && (
        <DeviceLink
          connectionKey={connectionKey}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DeviceLink({
  connectionKey,
  onClose,
}: {
  connectionKey: string;
  onClose: () => void;
}) {
  const link = privateWorkspaceLink(connectionKey);
  const [qr, setQr] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then((module) =>
        module.toDataURL(link, {
          width: 288,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
      )
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        if (active) setNotice("Use the private link below to connect.");
      });
    return () => {
      active = false;
    };
  }, [link]);
  return (
    <Sheet
      title="Connect another device"
      description="Scan with your phone’s camera to open this same workspace. No email sign-in needed."
      onClose={onClose}
    >
      <div className="device-link">
        {qr ? (
          <img
            className="workspace-qr"
            src={qr}
            alt="QR code to connect this workspace on another device"
            width={288}
            height={288}
          />
        ) : (
          <p className="small muted">Preparing your connection link…</p>
        )}
        <label>
          Private workspace link
          <input
            ref={input}
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <button
          className="primary-button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setNotice("Link copied. Open it on your other device.");
            } catch {
              input.current?.focus();
              input.current?.select();
              setNotice("Select and copy the link above.");
            }
          }}
        >
          <Copy size={16} />
          Copy private link
        </button>
        <p className="small muted">
          This link grants access to your tasks, logs, and calendar. Keep it
          private. Once connected, your phone remembers this workspace.
        </p>
        <p className="small" role="status">
          {notice}
        </p>
        <button className="secondary-button" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function openWorkspace() {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#/still/home`,
  );
  window.location.reload();
}

/** Kept outside App so its local workspace cannot save while switching devices. */
export function ConnectWorkspace({ initialKey = "" }: { initialKey?: string }) {
  const [value, setValue] = useState(initialKey);
  const [busy, setBusy] = useState(Boolean(initialKey));
  const [error, setError] = useState("");
  const pending = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (!initialKey) return;
    let active = true;
    pending.current ??= connectExistingWorkspace(initialKey);
    void pending.current
      .then(() => {
        if (active) openWorkspace();
      })
      .catch((failure) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not connect. Please retry.",
          );
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [initialKey]);
  return (
    <div className="theme theme-still workspace-connect-page">
      <main className="workspace-connect-card">
        <Smartphone size={30} />
        <p className="eyebrow">YOUR WORKSPACE, ON THIS DEVICE</p>
        <h1>Connect your workspace</h1>
        <p>
          On your connected desktop, open{" "}
          <strong>Settings → Connect another device</strong>. Scan the QR code
          with your phone, or paste the private link below.
        </p>
        <p className="small muted">
          Your existing tasks, calendar, and logs will load from Supabase. No
          email sign-in needed.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await connectExistingWorkspace(value);
              openWorkspace();
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Could not connect. Please retry.",
              );
              setBusy(false);
            }
          }}
        >
          <label>
            Private workspace link
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={busy}
              placeholder="Paste your link"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={17} />}
            {busy ? "Connecting…" : "Connect workspace"}
          </button>
        </form>
        <p className="small muted">
          Any existing data on this device is kept in a local recovery copy.
        </p>
        <button className="text-button" onClick={openWorkspace} disabled={busy}>
          Back to Elephant
        </button>
      </main>
    </div>
  );
}
