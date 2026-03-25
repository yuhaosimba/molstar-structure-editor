import { Viewer } from 'molstar/lib/apps/viewer/app';
import {
    enableStructureEditing,
    registerStructureEditor,
} from '../../src/index';

async function bootstrap() {
    const viewer = await Viewer.create('app', {
        layoutIsExpanded: true,
        layoutControlsDisplay: 'landscape',
        layoutShowControls: true,
        layoutShowSequence: false,
        layoutShowLog: false,
        layoutShowLeftPanel: true,
        viewportShowExpand: true,
        extensions: ['mvs'],
    });

    viewer.plugin.layout.setProps({
        isExpanded: true,
        controlsDisplay: 'landscape',
        showControls: true,
    });

    registerStructureEditor(viewer.plugin, {
        showToolbar: true,
        maxRealtimeAtoms: 512,
        realtimeUpdateMode: 'always',
    });
    enableStructureEditing(viewer.plugin);
    viewer.plugin.managers.interactivity.setProps({ granularity: 'element' });
    viewer.plugin.selectionMode = true;
    (window as any).__molstarStructureEditorPlugin = viewer.plugin;

    await viewer.loadStructureFromUrl(
        'https://models.rcsb.org/1crn.bcif',
        'mmcif',
        true,
    );
}

void bootstrap();
