import { type FormEvent, useState } from "react";

import type { Asset, CreateAssetPayload, UpdateAssetPayload } from "../../api/cmdb";
import { PanelState } from "../../components/PanelState";
import {
  assetFormToCreatePayload,
  assetFormToUpdatePayload,
  assetToForm,
  emptyAssetForm,
  validateAssetForm,
  type AssetFormMode,
  type AssetFormState,
} from "../../lib/assets";

type AssetFormProps = {
  asset?: Asset;
  cancelLabel?: string;
  mode: AssetFormMode;
  onCancel: () => void;
  onSubmitCreate?: (payload: CreateAssetPayload) => void;
  onSubmitUpdate?: (payload: UpdateAssetPayload) => void;
  submitError?: unknown;
  submitting: boolean;
};

function updateField<K extends keyof AssetFormState>(
  setForm: (updater: (current: AssetFormState) => AssetFormState) => void,
  key: K,
  value: AssetFormState[K],
) {
  setForm((current) => ({ ...current, [key]: value }));
}

export function AssetForm({
  asset,
  cancelLabel = "Cancel",
  mode,
  onCancel,
  onSubmitCreate,
  onSubmitUpdate,
  submitError,
  submitting,
}: AssetFormProps) {
  const [form, setForm] = useState<AssetFormState>(() => (asset ? assetToForm(asset) : emptyAssetForm));
  const [validationError, setValidationError] = useState("");
  const isCreate = mode === "create";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateAssetForm(form, mode);
    setValidationError(error);
    if (error) return;

    if (isCreate) {
      onSubmitCreate?.(assetFormToCreatePayload(form));
    } else {
      onSubmitUpdate?.(assetFormToUpdatePayload(form));
    }
  }

  return (
    <form className="request-form" onSubmit={handleSubmit}>
      {validationError ? <PanelState kind="error" message={validationError} /> : null}
      {submitError ? (
        <PanelState
          kind="error"
          message={submitError instanceof Error ? submitError.message : "Failed to save asset."}
        />
      ) : null}

      <div className="form-grid">
        <label className="form-field">
          <span>Name</span>
          <input
            value={form.name}
            onChange={(event) => updateField(setForm, "name", event.target.value)}
            disabled={submitting}
            required
          />
        </label>

        <label className="form-field">
          <span>Type</span>
          <input
            value={form.type}
            onChange={(event) => updateField(setForm, "type", event.target.value)}
            placeholder="ec2, rds, host"
            disabled={submitting || !isCreate}
            title={isCreate ? "" : "Type is immutable after create."}
          />
        </label>

        <label className="form-field">
          <span>Status</span>
          <input
            value={form.status}
            onChange={(event) => updateField(setForm, "status", event.target.value)}
            placeholder={isCreate ? "active" : ""}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Env</span>
          <input
            value={form.env}
            onChange={(event) => updateField(setForm, "env", event.target.value)}
            placeholder={isCreate ? "default" : ""}
            disabled={submitting}
          />
        </label>

        {isCreate ? (
          <>
            <label className="form-field">
              <span>Source</span>
              <input
                value={form.source}
                onChange={(event) => updateField(setForm, "source", event.target.value)}
                placeholder="manual"
                disabled={submitting}
              />
            </label>

            <label className="form-field">
              <span>External ID</span>
              <input
                value={form.externalID}
                onChange={(event) => updateField(setForm, "externalID", event.target.value)}
                disabled={submitting}
              />
            </label>
          </>
        ) : null}

        <label className="form-field">
          <span>Owner</span>
          <input
            value={form.owner}
            onChange={(event) => updateField(setForm, "owner", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Business unit</span>
          <input
            value={form.businessUnit}
            onChange={(event) => updateField(setForm, "businessUnit", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Criticality</span>
          <input
            value={form.criticality}
            onChange={(event) => updateField(setForm, "criticality", event.target.value)}
            placeholder="low / medium / high"
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Account ID</span>
          <input
            value={form.accountID}
            onChange={(event) => updateField(setForm, "accountID", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Region</span>
          <input
            value={form.region}
            onChange={(event) => updateField(setForm, "region", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Zone</span>
          <input
            value={form.zone}
            onChange={(event) => updateField(setForm, "zone", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Public IP</span>
          <input
            value={form.publicIP}
            onChange={(event) => updateField(setForm, "publicIP", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Private IP</span>
          <input
            value={form.privateIP}
            onChange={(event) => updateField(setForm, "privateIP", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Private DNS</span>
          <input
            value={form.privateDNS}
            onChange={(event) => updateField(setForm, "privateDNS", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>VPC ID</span>
          <input
            value={form.vpcID}
            onChange={(event) => updateField(setForm, "vpcID", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Subnet ID</span>
          <input
            value={form.subnetID}
            onChange={(event) => updateField(setForm, "subnetID", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>Instance type</span>
          <input
            value={form.instanceType}
            onChange={(event) => updateField(setForm, "instanceType", event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="form-field">
          <span>OS image</span>
          <input
            value={form.osImage}
            onChange={(event) => updateField(setForm, "osImage", event.target.value)}
            disabled={submitting}
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? "Saving" : isCreate ? "Create asset" : "Save changes"}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel} disabled={submitting}>
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}
