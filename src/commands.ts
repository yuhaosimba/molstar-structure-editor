import { PluginCommand } from 'molstar/lib/mol-plugin/command';

export const StructureEditorCommands = {
    EnterMoveMode: PluginCommand<{}>(),
    EnterRotateMode: PluginCommand<{}>(),
    CommitEdit: PluginCommand<{}>(),
    CancelEdit: PluginCommand<{}>(),
};
