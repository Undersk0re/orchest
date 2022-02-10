import argparse
import os
import sys

from kubernetes import client as k8s_client
from kubernetes import config

from _orchest.internals import config as _config
from _orchest.internals.utils import (
    get_k8s_namespace_name,
    get_step_and_kernel_volumes_and_volume_mounts,
)


def _get_kernel_pod_manifest(
    kernel_id: str, response_addr: str, spark_context_init_mode: str
) -> dict:
    image_name = os.environ.get("KERNEL_IMAGE", None)
    if image_name is None:
        sys.exit(
            "ERROR - KERNEL_IMAGE not found in environment - kernel launch terminating!"
        )
    image_name = os.environ["ORCHEST_REGISTRY"] + "/" + image_name

    kernel_username = os.environ.get("KERNEL_USERNAME")
    if kernel_username is None:
        name = f"kernel-{kernel_id}"
    else:
        name = f"kernel-{kernel_username}-{kernel_id}"

    metadata = {
        "name": name,
        "labels": {
            "project_uuid": os.environ["ORCHEST_PROJECT_UUID"],
            "session_uuid": os.environ["ORCHEST_SESSION_UUID"],
            "kernel_id": kernel_id,
            "component": "kernel",
            "app": "enterprise-gateway",
        },
    }

    vols, vol_mounts = get_step_and_kernel_volumes_and_volume_mounts(
        host_user_dir=os.environ.get("ORCHEST_HOST_USER_DIR"),
        host_project_dir=os.environ.get("ORCHEST_HOST_PROJECT_DIR"),
        host_pipeline_file=os.environ.get("ORCHEST_HOST_PIPELINE_FILE"),
        container_project_dir=_config.PROJECT_DIR,
        container_pipeline_file=_config.PIPELINE_FILE,
    )

    environment = dict()
    environment["EG_RESPONSE_ADDRESS"] = response_addr
    environment["KERNEL_SPARK_CONTEXT_INIT_MODE"] = spark_context_init_mode
    # Since the environment is specific to the kernel (per env stanza of
    # kernelspec, KERNEL_ and ENV_WHITELIST) just add the env here.
    environment.update(os.environ)
    # Let the image PATH be used. Since this is relative to images,
    # we're probably safe.
    environment.pop("PATH")
    env = [{"name": k, "value": v} for k, v in environment.items()]

    # K8S_TODO: device requests/gpus.
    pod_manifest = {
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": metadata,
        "spec": {
            "securityContext": {
                "runAsUser": 0,
                "runAsGroup": int(os.environ.get("ORCHEST_HOST_GID")),
                "fsGroup": int(os.environ.get("ORCHEST_HOST_GID")),
            },
            # "Kernel pods have restart policies of Never. This is
            # because the Jupyter framework already has built-in logic
            # for auto-restarting failed kernels and any other restart
            # policy would likely interfere with the built-in
            # behaviors."
            "restartPolicy": "Never",
            "volumes": vols,
            "containers": [
                {
                    "name": name,
                    "image": image_name,
                    "env": env,
                    "ports": [{"name": "web", "containerPort": 80, "protocol": "TCP"}],
                    "volume_mounts": vol_mounts,
                }
            ],
            "resources": {"requests": {"cpu": _config.USER_CONTAINERS_CPU_SHARES}},
        },
    }
    if os.environ.get("KERNEL_WORKING_DIR") is not None:
        pod_manifest["spec"]["containers"][0]["workingDir"] = os.environ[
            "KERNEL_WORKING_DIR"
        ]

    return pod_manifest


def launch_kernel(kernel_id, response_addr, spark_context_init_mode):
    manifest = _get_kernel_pod_manifest(
        kernel_id, response_addr, spark_context_init_mode
    )

    config.load_incluster_config()
    k8s_core_api = k8s_client.CoreV1Api()
    ns = get_k8s_namespace_name(os.environ["ORCHEST_SESSION_UUID"])
    k8s_core_api.create_namespaced_pod(ns, manifest)


if __name__ == "__main__":
    """
    Usage: launch_kernel
        [--RemoteProcessProxy.kernel-id <kernel_id>]
        [--RemoteProcessProxy.response-address <response_addr>]
        [--RemoteProcessProxy.spark-context-initialization-mode <mode>]
    """

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--RemoteProcessProxy.kernel-id",
        dest="kernel_id",
        nargs="?",
        help="Indicates the id associated with the launched kernel.",
    )
    parser.add_argument(
        "--RemoteProcessProxy.response-address",
        dest="response_address",
        nargs="?",
        metavar="<ip>:<port>",
        help="Connection address (<ip>:<port>) for returning connection file",
    )
    parser.add_argument(
        "--RemoteProcessProxy.spark-context-initialization-mode",
        dest="spark_context_init_mode",
        nargs="?",
        help="Indicates whether or how a spark context should be created",
        default="none",
    )

    arguments = vars(parser.parse_args())
    kernel_id = arguments["kernel_id"]
    response_addr = arguments["response_address"]
    spark_context_init_mode = arguments["spark_context_init_mode"]

    launch_kernel(kernel_id, response_addr, spark_context_init_mode)
