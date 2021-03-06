/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProfilerInput } from './profilerInput';

import { TabbedPanel } from 'sql/base/browser/ui/panel/panel';
import { Table } from 'sql/base/browser/ui/table/table';
import { TableDataView } from 'sql/base/browser/ui/table/tableDataView';
import { IProfilerService, IProfilerViewTemplate } from 'sql/parts/profiler/service/interfaces';
import { Taskbar } from 'sql/base/browser/ui/taskbar/taskbar';
import { attachTableStyler } from 'sql/common/theme/styler';
import { IProfilerStateChangedEvent } from './profilerState';
import { ProfilerTableEditor } from './controller/profilerTableEditor';
import * as Actions from 'sql/parts/profiler/contrib/profilerActions';
import { CONTEXT_PROFILER_EDITOR, PROFILER_TABLE_COMMAND_SEARCH } from './interfaces';
import { SelectBox } from 'sql/base/browser/ui/selectBox/selectBox';
import { textFormatter } from 'sql/parts/grid/services/sharedServices';

import * as DOM from 'vs/base/browser/dom';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { TPromise } from 'vs/base/common/winjs.base';
import { EditorOptions } from 'vs/workbench/common/editor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkbenchThemeService, VS_DARK_THEME, VS_HC_THEME } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ProfilerResourceEditor } from './profilerResourceEditor';
import { SplitView, View, Orientation, IViewOptions } from 'sql/base/browser/ui/splitview/splitview';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { ITextModel } from 'vs/editor/common/model';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { UntitledEditorInput } from 'vs/workbench/common/editor/untitledEditorInput';
import URI from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import * as nls from 'vs/nls';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Command } from 'vs/editor/browser/editorExtensions';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { ContextKeyExpr, IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { CommonFindController, FindStartFocusAction } from 'vs/editor/contrib/find/findController';
import * as types from 'vs/base/common/types';
import { attachSelectBoxStyler } from 'vs/platform/theme/common/styler';
import { DARK, HIGH_CONTRAST } from 'vs/platform/theme/common/themeService';

class BasicView extends View {
	private _previousSize: number;
	private _collapsed: boolean;
	public headerSize: number;
	constructor(
		initialSize: number,
		private _element: HTMLElement,
		private _focus: () => void,
		private _layout: (size: number, orientation: Orientation) => void,
		opts: IViewOptions
	) {
		super(initialSize, opts);
	}

	render(container: HTMLElement, orientation: Orientation): void {
		container.appendChild(this._element);
	}

	focus(): void {
		this._focus();
	}

	layout(size: number, orientation: Orientation): void {
		if (!this.collapsed) {
			this._previousSize = size;
		}
		this._layout(size, orientation);
	}

	set collapsed(val: boolean) {
		this._collapsed = val === false ? false : true;
		if (this.collapsed) {
			this._previousSize = this.size;
			this.setFixed(this.headerSize);
		} else {
			this.setFlexible(this._previousSize);
		}
	}

	get collapsed(): boolean {
		return this._collapsed;
	}
}

export interface IDetailData {
	label: string;
	value: string;
}

export class ProfilerEditor extends BaseEditor {
	public static ID: string = 'workbench.editor.profiler';
	private _editor: ProfilerResourceEditor;
	private _editorModel: ITextModel;
	private _editorInput: UntitledEditorInput;
	private _splitView: SplitView;
	private _container: HTMLElement;
	private _body: HTMLElement;
	private _header: HTMLElement;
	private _actionBar: Taskbar;
	private _tabbedPanel: TabbedPanel;
	private _profilerTableEditor: ProfilerTableEditor;
	private _detailTable: Table<IDetailData>;
	private _detailTableData: TableDataView<IDetailData>;
	private _stateListener: IDisposable;
	private _panelView: BasicView;

	private _profilerEditorContextKey: IContextKey<boolean>;

	private _viewTemplateSelector: SelectBox;
	private _viewTemplates: Array<IProfilerViewTemplate>;

	// Actions
	private _connectAction: Actions.ProfilerConnect;
	private _startAction: Actions.ProfilerStart;
	private _pauseAction: Actions.ProfilerPause;
	private _stopAction: Actions.ProfilerStop;
	private _autoscrollAction: Actions.ProfilerAutoScroll;
	private _collapsedPanelAction: Actions.ProfilerCollapsablePanelAction;


	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchThemeService themeService: IWorkbenchThemeService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@IContextMenuService private _contextMenuService: IContextMenuService,
		@IModelService private _modelService: IModelService,
		@IProfilerService private _profilerService: IProfilerService,
		@IContextKeyService private _contextKeyService: IContextKeyService,
		@IContextViewService private _contextViewService: IContextViewService
	) {
		super(ProfilerEditor.ID, telemetryService, themeService);
		this._profilerEditorContextKey = CONTEXT_PROFILER_EDITOR.bindTo(this._contextKeyService);
	}

	protected createEditor(parent: HTMLElement): void {
		// test backend
		//this._profilerService.registerProvider('default', this._instantiationService.createInstance(ProfilerTestBackend));

		this._container = document.createElement('div');
		this._container.className = 'carbon-profiler';
		parent.appendChild(this._container);

		this._createHeader();

		this._body = document.createElement('div');
		this._body.className = 'profiler-body';
		this._container.appendChild(this._body);
		this._splitView = new SplitView(this._body);

		let tableContainer = this._createProfilerTable();
		let paneContainer = this._createProfilerPane();
		this._splitView.addView(new BasicView(
			300,
			tableContainer,
			() => this._profilerTableEditor.focus(),
			size => this._profilerTableEditor.layout(new DOM.Dimension(parseFloat(DOM.getComputedStyle(this._body).width), size)),
			{}
		));

		this._panelView = new BasicView(
			300,
			paneContainer,
			() => this._tabbedPanel.focus(),
			size => this._tabbedPanel.layout(new DOM.Dimension(DOM.getTotalWidth(this._body), size)),
			{ minimumSize: 35 }
		);
		this._panelView.headerSize = 35;
		this._splitView.addView(this._panelView);
	}

	private _createHeader(): void {
		this._header = document.createElement('div');
		this._header.className = 'profiler-header';
		this._container.appendChild(this._header);
		this._actionBar = new Taskbar(this._header, this._contextMenuService);
		this._startAction = this._instantiationService.createInstance(Actions.ProfilerStart, Actions.ProfilerStart.ID, Actions.ProfilerStart.LABEL);
		this._startAction.enabled = false;
		this._stopAction = this._instantiationService.createInstance(Actions.ProfilerStop, Actions.ProfilerStop.ID, Actions.ProfilerStop.LABEL);
		this._stopAction.enabled = false;
		this._pauseAction = this._instantiationService.createInstance(Actions.ProfilerPause, Actions.ProfilerPause.ID, Actions.ProfilerPause.LABEL);
		this._pauseAction.enabled = false;
		this._connectAction = this._instantiationService.createInstance(Actions.ProfilerConnect, Actions.ProfilerConnect.ID, Actions.ProfilerConnect.LABEL);
		this._autoscrollAction = this._instantiationService.createInstance(Actions.ProfilerAutoScroll, Actions.ProfilerAutoScroll.ID, Actions.ProfilerAutoScroll.LABEL);

		this._viewTemplates = this._profilerService.getViewTemplates();
		this._viewTemplateSelector = new SelectBox(this._viewTemplates.map(i => i.name), 'Standard View', this._contextViewService);
		this._register(this._viewTemplateSelector.onDidSelect(e => {
			if (this.input) {
				this.input.viewTemplate = this._viewTemplates.find(i => i.name === e.selected);
			}
		}));
		let dropdownContainer = document.createElement('div');
		dropdownContainer.style.width = '150px';
		this._viewTemplateSelector.render(dropdownContainer);

		this._register(attachSelectBoxStyler(this._viewTemplateSelector, this.themeService));

		this._actionBar.setContent([
			{ action: this._startAction },
			{ action: this._stopAction },
			{ element: Taskbar.createTaskbarSeparator() },
			{ action: this._pauseAction },
			{ action: this._autoscrollAction },
			{ action: this._instantiationService.createInstance(Actions.ProfilerClear, Actions.ProfilerClear.ID, Actions.ProfilerClear.LABEL) },
			{ element: dropdownContainer },
		]);
	}

	private _createProfilerTable(): HTMLElement {
		let profilerTableContainer = document.createElement('div');
		profilerTableContainer.className = 'profiler-table monaco-editor';
		profilerTableContainer.style.width = '100%';
		profilerTableContainer.style.height = '100%';
		profilerTableContainer.style.overflow = 'hidden';
		profilerTableContainer.style.position = 'relative';
		let theme = this.themeService.getTheme();
		if (theme.type === DARK) {
			DOM.addClass(profilerTableContainer, VS_DARK_THEME);
		} else if (theme.type === HIGH_CONTRAST) {
			DOM.addClass(profilerTableContainer, VS_HC_THEME);
		}
		this.themeService.onThemeChange(e => {
			DOM.removeClasses(profilerTableContainer, VS_DARK_THEME, VS_HC_THEME);
			if (e.type === DARK) {
				DOM.addClass(profilerTableContainer, VS_DARK_THEME);
			} else if (e.type === HIGH_CONTRAST) {
				DOM.addClass(profilerTableContainer, VS_HC_THEME);
			}
		});
		this._profilerTableEditor = this._instantiationService.createInstance(ProfilerTableEditor);
		this._profilerTableEditor.createEditor(profilerTableContainer);
		this._profilerTableEditor.onSelectedRowsChanged((e, args) => {
			let data = this.input.data.getItem(args.rows[0]);
			if (data) {
				this._modelService.updateModel(this._editorModel, data['TextData']);
				this._detailTableData.clear();
				this._detailTableData.push(Object.keys(data).filter(key => {
					return data[key] !== ' ';
				}).map(key => {
					return {
						label: key,
						value: data[key]
					};
				}));

				if (this.input && types.isUndefinedOrNull(this.input.state.isPanelCollapsed)) {
					this.input.state.change({ isPanelCollapsed: false });
				}
			} else {
				this._modelService.updateModel(this._editorModel, '');
				this._detailTableData.clear();
			}

		});

		return profilerTableContainer;
	}

	private _createProfilerPane(): HTMLElement {
		let editorContainer = this._createProfilerEditor();
		let tabbedPanelContainer = document.createElement('div');
		tabbedPanelContainer.className = 'profiler-tabbedPane';
		this._tabbedPanel = new TabbedPanel(tabbedPanelContainer);
		this._tabbedPanel.pushTab({
			identifier: 'editor',
			title: nls.localize('text', "Text"),
			view: {
				layout: dim => this._editor.layout(dim),
				render: parent => parent.appendChild(editorContainer)
			}
		});

		let detailTableContainer = document.createElement('div');
		detailTableContainer.className = 'profiler-detailTable';
		detailTableContainer.style.width = '100%';
		detailTableContainer.style.height = '100%';
		this._detailTableData = new TableDataView<IDetailData>();
		this._detailTable = new Table(detailTableContainer, this._detailTableData, [
			{
				id: 'label',
				name: nls.localize('label', "Label"),
				field: 'label',
				formatter: textFormatter
			},
			{
				id: 'value',
				name: nls.localize('profilerEditor.value', "Value"),
				field: 'value',
				formatter: textFormatter
			}
		], { forceFitColumns: true });

		this._tabbedPanel.pushTab({
			identifier: 'detailTable',
			title: nls.localize('details', "Details"),
			view: {
				layout: dim => this._detailTable.layout(dim),
				render: parent => parent.appendChild(detailTableContainer)
			}
		});

		this._collapsedPanelAction = this._instantiationService.createInstance(Actions.ProfilerCollapsablePanelAction, Actions.ProfilerCollapsablePanelAction.ID, Actions.ProfilerCollapsablePanelAction.LABEL);

		this._tabbedPanel.pushAction(this._collapsedPanelAction, { icon: true, label: false });

		this._register(attachTableStyler(this._detailTable, this.themeService));

		return tabbedPanelContainer;
	}

	private _createProfilerEditor(): HTMLElement {
		this._editor = this._instantiationService.createInstance(ProfilerResourceEditor);
		let editorContainer = document.createElement('div');
		editorContainer.className = 'profiler-editor';
		this._editor.create(editorContainer);
		this._editor.setVisible(true);
		this._editorInput = this._instantiationService.createInstance(UntitledEditorInput, URI.from({ scheme: Schemas.untitled }), false, 'sql', '', '');
		this._editor.setInput(this._editorInput, undefined);
		this._editorInput.resolve().then(model => this._editorModel = model.textEditorModel);
		return editorContainer;
	}

	public get input(): ProfilerInput {
		return this._input as ProfilerInput;
	}

	public setInput(input: ProfilerInput, options?: EditorOptions): TPromise<void> {
		this._profilerEditorContextKey.set(true);
		if (input instanceof ProfilerInput && input.matches(this.input)) {
			return TPromise.as(null);
		}

		return super.setInput(input, options).then(() => {
			this._profilerTableEditor.setInput(input);

			if (input.viewTemplate) {
				this._viewTemplateSelector.selectWithOptionName(input.viewTemplate.name);
			} else {
				input.viewTemplate = this._viewTemplates.find(i => i.name === 'Standard View');
			}

			this._actionBar.context = input;
			this._tabbedPanel.actionBarContext = input;
			if (this._stateListener) {
				this._stateListener.dispose();
			}
			this._stateListener = input.state.addChangeListener(e => this._onStateChange(e));
			this._onStateChange({
				isConnected: true,
				isRunning: true,
				isPaused: true,
				isStopped: true,
				autoscroll: true,
				isPanelCollapsed: true
			});
			this._profilerTableEditor.updateState();
			this._splitView.layout();
			this._profilerTableEditor.focus();
		});
	}

	public clearInput(): void {
		this._profilerEditorContextKey.set(false);
	}

	public toggleSearch(): void {
		if (this._editor.getControl().isFocused()) {
			let editor = this._editor.getControl() as ICodeEditor;
			let controller = CommonFindController.get(editor);
			if (controller) {
				controller.start({
					forceRevealReplace: false,
					seedSearchStringFromGlobalClipboard: false,
					seedSearchStringFromSelection: (controller.getState().searchString.length === 0),
					shouldFocus: FindStartFocusAction.FocusFindInput,
					shouldAnimate: true
				});
			}
		} else {
			this._profilerTableEditor.toggleSearch();
		}
	}

	private _onStateChange(e: IProfilerStateChangedEvent): void {
		if (e.autoscroll) {
			this._autoscrollAction.checked = this.input.state.autoscroll;
		}

		if (e.isPanelCollapsed) {
			this._collapsedPanelAction.collapsed = this.input.state.isPanelCollapsed;
			this._tabbedPanel.collapsed = this.input.state.isPanelCollapsed;
			this._panelView.collapsed = this.input.state.isPanelCollapsed;
		}

		if (e.isConnected) {
			this._connectAction.connected = this.input.state.isConnected;
			if (!this.input.state.isConnected) {
				this._startAction.enabled = this.input.state.isConnected;
				this._stopAction.enabled = false;
				this._pauseAction.enabled = false;
				return;
			}
		}

		if (e.isPaused){
			this._pauseAction.paused = this.input.state.isPaused;
			this._pauseAction.enabled = !this.input.state.isStopped && (this.input.state.isRunning || this.input.state.isPaused);
		}

		if (e.isStopped || e.isRunning) {
			this._startAction.enabled = !this.input.state.isRunning && !this.input.state.isPaused;
			this._stopAction.enabled = !this.input.state.isStopped && (this.input.state.isRunning || this.input.state.isPaused);
			this._pauseAction.enabled = !this.input.state.isStopped && (this.input.state.isRunning || this.input.state.isPaused);
		}
	}

	public layout(dimension: DOM.Dimension): void {
		this._container.style.width = dimension.width + 'px';
		this._container.style.height = dimension.height + 'px';
		this._body.style.width = dimension.width + 'px';
		this._body.style.height = (dimension.height - (28 + 4)) + 'px';
		this._splitView.layout(dimension.height - (28 + 4));
	}
}

abstract class SettingsCommand extends Command {

	protected getProfilerEditor(accessor: ServicesAccessor): ProfilerEditor {
		const activeEditor = accessor.get(IWorkbenchEditorService).getActiveEditor();
		if (activeEditor instanceof ProfilerEditor) {
			return activeEditor;
		}
		return null;

	}

}

class StartSearchProfilerTableCommand extends SettingsCommand {

	public runCommand(accessor: ServicesAccessor, args: any): void {
		const preferencesEditor = this.getProfilerEditor(accessor);
		if (preferencesEditor) {
			preferencesEditor.toggleSearch();
		}
	}

}

const command = new StartSearchProfilerTableCommand({
	id: PROFILER_TABLE_COMMAND_SEARCH,
	precondition: ContextKeyExpr.and(CONTEXT_PROFILER_EDITOR),
	kbOpts: { primary: KeyMod.CtrlCmd | KeyCode.KEY_F }
});

KeybindingsRegistry.registerCommandAndKeybindingRule(command.toCommandAndKeybindingRule(KeybindingsRegistry.WEIGHT.editorContrib()));
