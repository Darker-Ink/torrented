import type { ReactNode } from "react";
import Button from "./Button";
import Modal from "./Modal";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
};

const ConfirmDialog = ({ open, onClose, onConfirm, title, children, confirmLabel = "Confirm", danger, loading }: Props) => (
  <Modal
    open={open}
    onClose={onClose}
    title={title}
    size="sm"
    footer={
      <>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </>
    }
  >
    <div className="text-sm text-muted">{children}</div>
  </Modal>
);

export default ConfirmDialog;
