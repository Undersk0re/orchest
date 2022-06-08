import ProjectFilePicker from "@/components/ProjectFilePicker";
import { useCheckFileValidity } from "@/hooks/useCheckFileValidity";
import { useCustomRoute } from "@/hooks/useCustomRoute";
import { useFetchPipeline } from "@/hooks/useFetchPipeline";
import {
  FileManagerContextProvider,
  useFileManagerContext,
} from "@/pipeline-view/file-manager/FileManagerContext";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import React from "react";

const ProjectFilePickerHolder = ({
  selectedPath,
  pipelineCwd,
  onChangeFilePath,
  pipelineUuid,
}) => {
  const { fetchFileTrees } = useFileManagerContext();

  React.useEffect(() => {
    fetchFileTrees(1);
  }, [fetchFileTrees]);

  const { projectUuid } = useCustomRoute();

  const [
    doesFileExist,
    isCheckingFileValidity,
  ] = useCheckFileValidity(projectUuid, pipelineUuid, selectedPath, ["json"]);

  return (
    <ProjectFilePicker
      value={selectedPath}
      allowedExtensions={["json"]}
      pipelineCwd={pipelineCwd}
      onChange={onChangeFilePath}
      menuMaxWidth={"100%"}
      doesFileExist={doesFileExist}
      isCheckingFileValidity={isCheckingFileValidity}
    />
  );
};

export const LoadParametersDialog = ({
  isOpen,
  onClose,
  onSubmit,
  projectUuid,
  pipelineUuid,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  projectUuid: string | undefined;
  pipelineUuid: string | undefined;
}) => {
  const { pipeline } = useFetchPipeline({ projectUuid, pipelineUuid });
  const [selectedPath, setSelectedPath] = React.useState("");

  const pipelineCwd = pipeline?.path.replace(/\/?[^\/]*.orchest$/, "/");

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{ sx: { overflowY: "visible" } }}
    >
      <form
        id="load-parameters"
        onSubmit={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          onSubmit(selectedPath);
        }}
      >
        <DialogTitle>Load parameter file</DialogTitle>
        <DialogContent sx={{ overflowY: "visible" }}>
          <Stack direction="column" spacing={2}>
            <FileManagerContextProvider>
              <ProjectFilePickerHolder
                selectedPath={selectedPath}
                pipelineCwd={pipelineCwd}
                onChangeFilePath={setSelectedPath}
                pipelineUuid={pipelineUuid}
              />
            </FileManagerContextProvider>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="secondary" tabIndex={-1} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="contained" type="submit" form="load-parameters">
            Load
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
