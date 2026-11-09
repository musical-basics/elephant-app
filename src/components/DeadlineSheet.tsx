import { useState } from "react";
import { Flag } from "lucide-react";
import Sheet from "./Sheet";
import { localDateKey } from "../lib/schedule";
import type { Deadline, DeadlineDraft } from "../lib/deadlines";

export default function DeadlineSheet({
  deadline,
  date,
  onClose,
  onSave,
}: {
  deadline?: Deadline;
  date?: string;
  onClose: () => void;
  onSave: (draft: DeadlineDraft) => void;
}) {
  const [error, setError] = useState("");
  return (
    <Sheet
      title={deadline ? "Edit deadline" : "Set a deadline."}
      description="Something due by the end of a day. It stays on your calendar until you complete it."
      onClose={onClose}
    >
      <form
        className="sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          try {
            onSave({
              title: String(fields.get("title")),
              dueDate: String(fields.get("dueDate")),
            });
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Please check the fields.",
            );
          }
        }}
      >
        <label>
          What’s due?
          <input
            data-autofocus
            required
            name="title"
            maxLength={500}
            defaultValue={deadline?.title ?? ""}
            placeholder="Taxes, a renewal, a form to send…"
          />
        </label>
        <label>
          Due date
          <input
            required
            type="date"
            name="dueDate"
            defaultValue={deadline?.dueDate ?? date ?? localDateKey(new Date())}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            <Flag size={17} />
            {deadline ? "Save changes" : "Add deadline"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
