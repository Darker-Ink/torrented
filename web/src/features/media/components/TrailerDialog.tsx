import Modal from "@/features/ui/components/Modal";

type Props = { open: boolean; onClose: () => void; youtubeKey: string; title: string };

const TrailerDialog = ({ open, onClose, youtubeKey, title }: Props) => (
  <Modal open={open} onClose={onClose} size="xl" bare>
    <div className="aspect-video w-full bg-black">
      {open && (
        <iframe
          title={`${title} trailer`}
          src={`https://www.youtube-nocookie.com/embed/${youtubeKey}?autoplay=1&rel=0`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="size-full"
        />
      )}
    </div>
  </Modal>
);

export default TrailerDialog;
