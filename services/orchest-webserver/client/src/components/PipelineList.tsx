import { useAppContext } from "@/contexts/AppContext";
import { useSessionsContext } from "@/contexts/SessionsContext";
import { useAsync } from "@/hooks/useAsync";
import { useCustomRoute } from "@/hooks/useCustomRoute";
import { useSessionsPoller } from "@/hooks/useSessionsPoller";
import { IOrchestSession } from "@/types";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { fetcher, hasValue } from "@orchest/lib-utils";
import React from "react";
import useSWR from "swr";
import { siteMap } from "../Routes";
import { checkGate } from "../utils/webserver-utils";
import { IconButton } from "./common/IconButton";
import { DataTable, DataTableColumn } from "./DataTable";
import SessionToggleButton from "./SessionToggleButton";

const INITIAL_PIPELINE_NAME = "Main";
const INITIAL_PIPELINE_PATH = "main.orchest";

const regExp = new RegExp(`^${INITIAL_PIPELINE_NAME}( [0-9]+)?`, "i");

const getValidNewPipelineName = (pipelines: PipelineMetaData[]) => {
  const largestExistingNumber = pipelines.reduce((existingNumber, pipeline) => {
    const matches = pipeline.name.match(regExp);
    if (!matches) return existingNumber;
    // if the name is "Main", matches[1] will be undefined, we count it as 0
    // if the name is "Main", matches[1] will be " 123", trim it and parse it as Integer
    const currentNumber = !matches[1] ? 0 : parseInt(matches[1].trim());
    return Math.max(existingNumber, currentNumber);
  }, -1);
  const newNumber = largestExistingNumber + 1;
  return newNumber > 0
    ? `${INITIAL_PIPELINE_NAME} ${newNumber}`
    : INITIAL_PIPELINE_NAME;
};

const getPathFromName = (name: string) =>
  `${name.toLowerCase().replace(/[\W]/g, "_")}.orchest`;

const getErrorMessages = (path: string) => ({
  0: "",
  1: "Cannot change the pipeline path if an interactive session is running. Please stop it first.",
  2: `Cannot change the pipeline path, a file path with the name ${path}" already exists.`,
  3: "The pipeline does not exist.",
  4: 'The pipeline file name should end with ".orchest".',
  5: "The pipeline file does not exist.",
  6: "Can't move the pipeline outside of the project.",
});

type PipelineMetaData = {
  name: string;
  path: string;
  uuid: string;
};

type SessionStatus = IOrchestSession["status"] | "";

type PipelineRowData = PipelineMetaData & {
  sessionStatus: SessionStatus;
};

const fetchPipelines = (uuid: string) =>
  fetcher<{ success: boolean; result: PipelineMetaData[] }>(uuid).then(
    (response) => response.result
  );

const requestDeletePipelines = (projectUuid: string, pipelineUuid: string) => {
  return fetcher(`/async/pipelines/delete/${projectUuid}/${pipelineUuid}`, {
    method: "DELETE",
  });
};

const getColumns = (
  projectUuid: string,
  onEditPath: (uuid: string, path: string) => void
): DataTableColumn<PipelineRowData>[] => [
  {
    id: "name",
    label: "Pipeline",
    sx: { maxWidth: "30%", wordBreak: "break-word" },
  },
  {
    id: "path",
    label: "Path",
    sx: {
      maxWidth: "30%",
      wordBreak: "break-word",
    },
    render: function PipelineName(row) {
      return (
        <Stack
          direction="row"
          alignItems="center"
          component="span"
          sx={{
            display: "inline-flex",
            marginLeft: (theme) => theme.spacing(6),
            button: { visibility: "hidden" },
            "&:hover": {
              button: { visibility: "visible" },
            },
          }}
          data-test-id="pipeline-path"
        >
          {row.path}
          <IconButton
            title="Edit pipeline path"
            size="small"
            sx={{ marginLeft: (theme) => theme.spacing(2) }}
            onClick={(e: React.MouseEvent<unknown>) => {
              e.stopPropagation();
              onEditPath(row.uuid, row.path);
            }}
            data-test-id="pipeline-edit-path"
          >
            <EditIcon />
          </IconButton>
        </Stack>
      );
    },
  },
  {
    id: "sessionStatus",
    label: "Session",
    render: function SessionStatus(row) {
      return (
        <Box
          sx={{ minWidth: (theme) => theme.spacing(26), textAlign: "center" }}
        >
          <SessionToggleButton
            projectUuid={projectUuid}
            pipelineUuid={row.uuid}
            status={row.sessionStatus}
            isSwitch
          />
        </Box>
      );
    },
  },
];

const PipelinePathTextField: React.FC<{
  value: string;
  onChange: (value: string) => void;
}> = ({ value, onChange }) => {
  const pathInputRef = React.useRef<HTMLInputElement>();
  const initializedRef = React.useRef(false);
  React.useEffect(() => {
    if (pathInputRef.current && value && !initializedRef.current) {
      initializedRef.current = true;
      pathInputRef.current.focus();
      pathInputRef.current.setSelectionRange(
        value.indexOf(".orchest"),
        value.indexOf(".orchest")
      );
    }
  }, [value]);

  return (
    <TextField
      margin="normal"
      fullWidth
      autoFocus
      value={value}
      label="Pipeline path"
      inputRef={pathInputRef}
      onChange={(e) => {
        const value = e.target.value;
        onChange(value);
      }}
      data-test-id="pipeline-edit-path-textfield"
    />
  );
};

const PipelineList: React.FC<{ projectUuid: string }> = ({ projectUuid }) => {
  const { navigateTo } = useCustomRoute();
  const { setAlert, setConfirm } = useAppContext();
  const { getSession } = useSessionsContext();
  useSessionsPoller();

  const {
    data: pipelines,
    error,
    revalidate: requestFetchPipelines,
    isValidating,
  } = useSWR<PipelineMetaData[]>(
    `/async/pipelines/${projectUuid}`,
    fetchPipelines
  );

  React.useEffect(() => {
    if (error) {
      setAlert("Error", `Failed to fetch pipelines: ${error}`);
      navigateTo(siteMap.projects.path);
    }
  }, [error]);

  const pipelineRows = React.useMemo(() => {
    return (pipelines || []).map((pipeline) => {
      return {
        ...pipeline,
        sessionStatus: (getSession({
          pipelineUuid: pipeline.uuid,
          projectUuid,
        })?.status || "") as SessionStatus,
      };
    });
  }, [pipelines, projectUuid, getSession]);

  const [pipelineInEdit, setPipelineInEdit] = React.useState<{
    uuid: string;
    path: string;
  }>(null);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false);

  const [isEditingPipelinePath, setIsEditingPipelinePath] = React.useState(
    true
  );

  const [state, setState] = React.useState({
    createPipelineName: INITIAL_PIPELINE_NAME,
    createPipelinePath: INITIAL_PIPELINE_PATH,
  });

  const isPathTaken = pipelineRows.some(
    (row) => row.path === state.createPipelinePath
  );

  React.useEffect(() => {
    // create a valid name if name is taken
    if (pipelines && isCreateDialogOpen) {
      const newName = getValidNewPipelineName(pipelines);
      setState({
        createPipelineName: newName,
        createPipelinePath: getPathFromName(newName),
      });
    }
  }, [pipelines, isCreateDialogOpen]);

  const openPipeline = (pipelineUuid: string, isReadOnly: boolean) => {
    navigateTo(siteMap.pipeline.path, {
      query: { projectUuid, pipelineUuid },
      state: { isReadOnly },
    });
  };

  const onRowClick = async (pipelineUuid: string) => {
    try {
      await checkGate(projectUuid);
      openPipeline(pipelineUuid, false);
    } catch (error) {
      openPipeline(pipelineUuid, true);
    }
  };

  const deletePipelines = async (pipelineUuids: string[]) => {
    return setConfirm(
      "Warning",
      "Are you certain that you want to delete this pipeline? (This cannot be undone.)",
      async (resolve) => {
        Promise.all(
          pipelineUuids.map((uuid) => requestDeletePipelines(projectUuid, uuid))
        )
          .then(() => {
            requestFetchPipelines();
            resolve(true);
          })
          .catch((e) => {
            setAlert("Error", `Failed to delete pipeline: ${e}`);
            resolve(false);
          });

        return true;
      }
    );
  };

  const onCloseEditPipelineModal = () => {
    setIsEditingPipelinePath(false);
  };

  const onSubmitEditPipelinePathModal = () => {
    if (!pipelineInEdit) return;
    if (!pipelineInEdit.path.endsWith(".orchest")) {
      setAlert("Error", "The path should end in the .orchest extension.");

      return;
    }

    run(
      fetcher(`/async/pipelines/${projectUuid}/${pipelineInEdit.uuid}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          path: pipelineInEdit.path,
        }),
      })
        .then(() => {
          requestFetchPipelines();
        })
        .catch((e) => {
          try {
            let resp = JSON.parse(e.body);

            setAlert("Error", getErrorMessages(pipelineInEdit.path)[resp.code]);
          } catch (error) {
            console.error(error);
          }
        })
        .finally(() => {
          onCloseEditPipelineModal();
        })
    );
  };

  const onEditClick = (uuid: string, path: string) => {
    setIsEditingPipelinePath(true);
    setPipelineInEdit({ uuid, path });
  };

  const onCreateClick = () => {
    setIsCreateDialogOpen(true);
  };

  // monitor if there's any operations ongoing, if so, disable action buttons
  const { run, status } = useAsync<void>();
  const isOperating = status === "PENDING";

  const onSubmitCreatePipeline = () => {
    let pipelineName = state.createPipelineName;
    let pipelinePath = state.createPipelinePath;

    if (!pipelineName) {
      setAlert("Error", "Please enter a name.");
      return;
    }

    if (!pipelinePath || pipelinePath === ".orchest") {
      setAlert("Error", "Please enter the path for the pipeline.");
      return;
    }

    if (!pipelinePath.endsWith(".orchest")) {
      setAlert("Error", "The path should end in the .orchest extension.");
      return;
    }

    run(
      fetcher(`/async/pipelines/create/${projectUuid}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          name: pipelineName,
          pipeline_path: pipelinePath,
        }),
      })
        .then(() => {
          requestFetchPipelines();
        })
        .catch((response) => {
          if (!response.isCanceled) {
            try {
              let data = JSON.parse(response.body);
              setAlert("Error", `Could not create pipeline. ${data.message}`);
            } catch {
              setAlert("Error", "Could not create pipeline. Reason unknown.");
            }
          }
        })
    );

    setIsCreateDialogOpen(false);
  };

  const onCloseCreatePipelineModal = () => {
    setIsCreateDialogOpen(false);
  };

  const columns = React.useMemo(() => getColumns(projectUuid, onEditClick), [
    projectUuid,
  ]);

  const isLoaded = hasValue(pipelines) && !error;

  return !isLoaded ? (
    <div className={"pipelines-view"}>
      <h2>Pipelines</h2>
      <LinearProgress />
    </div>
  ) : (
    <div className={"pipelines-view"}>
      <Dialog
        fullWidth
        maxWidth="xs"
        open={isCreateDialogOpen}
        onClose={onCloseCreatePipelineModal}
      >
        <form
          id="create-pipeline"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSubmitCreatePipeline();
          }}
        >
          <DialogTitle>Create a new pipeline</DialogTitle>
          <DialogContent>
            <TextField
              margin="normal"
              fullWidth
              autoFocus
              value={state.createPipelineName}
              label="Pipeline name"
              onChange={(e) => {
                const value = e.target.value;
                setState((prevState) => ({
                  ...prevState,
                  createPipelinePath: getPathFromName(value),
                  createPipelineName: value,
                }));
              }}
              data-test-id="pipeline-name-textfield"
            />
            <TextField
              margin="normal"
              fullWidth
              label="Pipeline path"
              onChange={(e) => {
                const value = e.target.value;
                setState((prevState) => ({
                  ...prevState,
                  createPipelinePath: value,
                }));
              }}
              value={state.createPipelinePath}
              error={isPathTaken}
              helperText={isPathTaken ? "File already exists" : ""}
              data-test-id="pipeline-path-textfield"
            />
          </DialogContent>
          <DialogActions>
            <Button
              startIcon={<CloseIcon />}
              color="secondary"
              onClick={onCloseCreatePipelineModal}
            >
              Cancel
            </Button>
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              type="submit"
              form="create-pipeline"
              disabled={isPathTaken || isOperating}
              data-test-id="pipeline-create-ok"
            >
              Create pipeline
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Dialog
        fullWidth
        maxWidth="xs"
        open={isEditingPipelinePath && pipelineInEdit !== null}
        onClose={onCloseEditPipelineModal}
      >
        <form
          id="edit-pipeline-path"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSubmitEditPipelinePathModal();
          }}
        >
          <DialogTitle>Edit pipeline path</DialogTitle>
          <DialogContent>
            <PipelinePathTextField
              value={pipelineInEdit?.path}
              onChange={(newPath) => {
                setPipelineInEdit((current) => ({ ...current, path: newPath }));
              }}
            />
          </DialogContent>
          <DialogActions>
            <Button
              startIcon={<CloseIcon />}
              color="secondary"
              onClick={onCloseEditPipelineModal}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              disabled={isOperating}
              type="submit"
              form="edit-pipeline-path"
              data-test-id="pipeline-edit-path-save"
            >
              Save
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <h2>Pipelines</h2>
      <div className="push-down">
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onCreateClick}
          data-test-id="pipeline-create"
        >
          Create pipeline
        </Button>
      </div>

      <DataTable<PipelineRowData>
        id="pipeline-list"
        selectable
        hideSearch
        isLoading={isValidating}
        columns={columns}
        rows={pipelineRows}
        onRowClick={onRowClick}
        deleteSelectedRows={deletePipelines}
      />
    </div>
  );
};

export default PipelineList;
