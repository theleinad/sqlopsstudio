/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { ITaskService } from 'sql/parts/taskHistory/common/taskService';
import { MainThreadBackgroundTaskManagementShape, SqlMainContext, ExtHostBackgroundTaskManagementShape, SqlExtHostContext } from 'sql/workbench/api/node/sqlExtHost.protocol';

import { extHostNamedCustomer } from 'vs/workbench/api/electron-browser/extHostCustomers';
import { IExtHostContext } from 'vs/workbench/api/node/extHost.protocol';
import { Disposable } from 'vs/base/common/lifecycle';


import * as sqlops from 'sqlops';

export enum TaskStatus {
	notStarted = 0,
	inProgress = 1,
	succeeded = 2,
	succeededWithWarning = 3,
	failed = 4,
	canceled = 5,
	canceling = 6
}

@extHostNamedCustomer(SqlMainContext.MainThreadBackgroundTaskManagement)
export class MainThreadBackgroundTaskManagement extends Disposable implements MainThreadBackgroundTaskManagementShape {
	private readonly _proxy: ExtHostBackgroundTaskManagementShape;

	constructor(
		context: IExtHostContext,
		@ITaskService private _taskService: ITaskService
	) {
		super();
		this._proxy = context.getProxy(SqlExtHostContext.ExtHostBackgroundTaskManagement);
		this._register(this._taskService.onTaskComplete(task => {
			if (task.status === TaskStatus.canceling) {
				this._proxy.$onTaskCanceled(task.id);
			}
		}));
	}

	$registerTask(taskInfo: sqlops.TaskInfo): void {
		this._taskService.createNewTask(taskInfo);
		this._proxy.$onTaskRegistered(taskInfo.taskId, taskInfo);
	}

	$updateTask(taskProgressInfo: sqlops.TaskProgressInfo): void {
		this._taskService.updateTask(taskProgressInfo);
	}
}
