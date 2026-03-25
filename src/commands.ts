import { PluginCommand } from 'molstar/lib/mol-plugin/command';

export const StructureEditorCommands = {
    EnterMoveMode: PluginCommand<{}>(),
    EnterRotateMode: PluginCommand<{}>(),
    EnterDistanceMode: PluginCommand<{}>(),
    EnterAngleMode: PluginCommand<{}>(),
    EnterDihedralMode: PluginCommand<{}>(),
    CommitEdit: PluginCommand<{}>(),
    CancelEdit: PluginCommand<{}>(),
};
