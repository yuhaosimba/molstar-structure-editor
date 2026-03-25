import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { StructureEditorCommands } from './commands';
import { getOrCreateStructureEditor, StructureEditorOptions } from './behavior';

export function registerStructureEditor(plugin: PluginContext, options: StructureEditorOptions = {}) {
    return getOrCreateStructureEditor(plugin, options);
}

export function enableStructureEditing(plugin: PluginContext, options: StructureEditorOptions = {}) {
    return getOrCreateStructureEditor(plugin, options);
}

export function enterMoveMode(plugin: PluginContext) {
    registerStructureEditor(plugin);
    return StructureEditorCommands.EnterMoveMode(plugin, {});
}

export function enterRotateMode(plugin: PluginContext) {
    registerStructureEditor(plugin);
    return StructureEditorCommands.EnterRotateMode(plugin, {});
}

export function enterDistanceMode(plugin: PluginContext) {
    registerStructureEditor(plugin);
    return StructureEditorCommands.EnterDistanceMode(plugin, {});
}

export function enterAngleMode(plugin: PluginContext) {
    registerStructureEditor(plugin);
    return StructureEditorCommands.EnterAngleMode(plugin, {});
}

export function enterDihedralMode(plugin: PluginContext) {
    registerStructureEditor(plugin);
    return StructureEditorCommands.EnterDihedralMode(plugin, {});
}

export function commitEdit(plugin: PluginContext) {
    registerStructureEditor(plugin);
    return StructureEditorCommands.CommitEdit(plugin, {});
}

export function cancelEdit(plugin: PluginContext) {
    registerStructureEditor(plugin);
    return StructureEditorCommands.CancelEdit(plugin, {});
}

export type { StructureEditorOptions } from './behavior';
