import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachmentApi } from '../services/api';

export function useAttachments(
  orgId: string,
  projectId: string,
  boardId: string,
  taskId: string,
) {
  return useQuery({
    queryKey: ['attachments', taskId],
    queryFn: () => attachmentApi.list(orgId, projectId, boardId, taskId),
  });
}

export function useAttachmentActions(
  orgId: string,
  projectId: string,
  boardId: string,
  taskId: string,
) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['attachments', taskId] });

  const upload = useMutation({
    mutationFn: (file: File) =>
      attachmentApi.upload(orgId, projectId, boardId, taskId, file),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) =>
      attachmentApi.remove(orgId, projectId, boardId, taskId, attachmentId),
    onSuccess: refresh,
  });

  // A download changes nothing on the server, so it is a plain async function
  // rather than a mutation; the component tracks its own "downloading" state.
  const download = (attachmentId: string) =>
    attachmentApi.download(orgId, projectId, boardId, taskId, attachmentId);

  return { upload, remove, download };
}
