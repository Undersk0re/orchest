"""API endpoint to manage projects.

Despite the fact that the orchest api has no model related to a
project, a good amount of other models depend on such a concept.
"""
from flask import abort, current_app, request
from flask_restx import Namespace, Resource
from sqlalchemy.orm import undefer

import app.models as models
from _orchest.internals import utils as _utils
from _orchest.internals.two_phase_executor import TwoPhaseExecutor, TwoPhaseFunction
from app import schema
from app.apis.namespace_environment_images import DeleteProjectEnvironmentImages
from app.apis.namespace_jobs import DeleteJob
from app.apis.namespace_runs import AbortPipelineRun
from app.apis.namespace_sessions import StopInteractiveSession
from app.connections import db
from app.utils import register_schema

api = Namespace("projects", description="Managing Projects")
api = register_schema(api)


@api.route("/")
class ProjectList(Resource):
    @api.doc("get_projects")
    @api.marshal_with(schema.projects)
    def get(self):
        """Get all projects."""

        projects = models.Project.query.all()
        return {"projects": [proj.__dict__ for proj in projects]}, 200

    @api.doc("create_project")
    @api.expect(schema.project)
    @api.marshal_with(schema.project)
    def post(self):
        """Create a new project."""
        project = request.get_json()
        project["env_variables"] = project.get("env_variables", {})
        if not _utils.are_environment_variables_valid(project["env_variables"]):
            return {"message": ("Invalid environment variables definition.")}, 400
        try:
            db.session.add(models.Project(**project))
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(e)
            return {"message": "Project creation failed."}, 500
        return project, 201


@api.route("/<string:project_uuid>")
@api.param("project_uuid", "uuid of the project")
class Project(Resource):
    @api.doc("get_project")
    @api.marshal_with(schema.project, code=200)
    def get(self, project_uuid):
        """Fetches a project given its uuid."""
        project = (
            models.Project.query.options(undefer(models.Project.env_variables))
            .filter_by(uuid=project_uuid)
            .one_or_none()
        )
        if project is None:
            abort(404, "Project not found.")
        return project

    @api.expect(schema.project_update)
    @api.doc("update_project")
    def put(self, project_uuid):
        """Update a project."""
        update = request.get_json()
        update = models.Project.keep_column_entries(update)
        if not _utils.are_environment_variables_valid(update.get("env_variables", {})):
            return {"message": ("Invalid environment variables definition.")}, 400
        if update:
            try:
                models.Project.query.filter_by(uuid=project_uuid).update(update)
                db.session.commit()
            except Exception as e:
                db.session.rollback()
                current_app.logger.error(e)
                return {"message": "Failed update operation."}, 500

        return {"message": "Project was updated successfully."}, 200

    @api.doc("delete_project")
    @api.response(200, "Project deleted")
    def delete(self, project_uuid):
        """Delete a project.

        Any session, run, job related to the project is stopped
        and removed from the db. Environment images are removed.
        """
        try:
            with TwoPhaseExecutor(db.session) as tpe:
                DeleteProject(tpe).transaction(project_uuid)

        except Exception as e:
            return {"message": str(e)}, 500

        return {"message": "Project deletion was successful."}, 200


class DeleteProject(TwoPhaseFunction):
    """Delete a project and all related entities.


    Project sessions, runs and jobs are stopped. Every
    related entity in the db is removed. Environment images are
    deleted up.
    """

    def _transaction(self, project_uuid: str):
        # Any interactive run related to the project is stopped if
        # if necessary, then deleted.
        interactive_runs = (
            models.InteractivePipelineRun.query.filter_by(project_uuid=project_uuid)
            .filter(models.InteractivePipelineRun.status.in_(["PENDING", "STARTED"]))
            .all()
        )
        for run in interactive_runs:
            AbortPipelineRun(self.tpe).transaction(run.uuid)
            # Will delete cascade interactive run pipeline step,
            # interactive run image mapping.
            db.session.delete(run)

        # Stop (and delete) any interactive session related to the
        # project.
        sessions = (
            models.InteractiveSession.query.filter_by(
                project_uuid=project_uuid,
            )
            .with_entities(
                models.InteractiveSession.project_uuid,
                models.InteractiveSession.pipeline_uuid,
            )
            .distinct()
            .all()
        )
        for session in sessions:
            # Stop any interactive session related to the pipeline.
            StopInteractiveSession(self.tpe).transaction(
                project_uuid, session.pipeline_uuid, async_mode=True
            )

        # Any job related to the pipeline is stopped if necessary
        # , then deleted.
        jobs = (
            models.Job.query.filter_by(
                project_uuid=project_uuid,
            )
            .with_entities(models.Job.uuid)
            .all()
        )
        for job in jobs:
            DeleteJob(self.tpe).transaction(job.uuid)

        # Remove images related to the project.
        DeleteProjectEnvironmentImages(self.tpe).transaction(project_uuid)

        models.Project.query.filter_by(uuid=project_uuid).delete()

    def _collateral(self):
        pass
