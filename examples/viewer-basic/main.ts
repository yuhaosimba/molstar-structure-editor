import { Viewer } from 'molstar/lib/apps/viewer/app';
import {
    enableStructureEditing,
    registerStructureEditor,
} from '../../src/index';

async function bootstrap() {
    const viewer = await Viewer.create('app', {
        layoutIsExpanded: false,
        layoutShowControls: true,
        layoutShowSequence: false,
        layoutShowLog: false,
        layoutShowLeftPanel: true,
        viewportShowExpand: true,
        extensions: ['mvs'],
    });

    registerStructureEditor(viewer.plugin, {
        showToolbar: true,
        maxRealtimeAtoms: 512,
        realtimeUpdateMode: 'always',
    });
    enableStructureEditing(viewer.plugin);
    viewer.plugin.managers.interactivity.setProps({ granularity: 'element' });
    viewer.plugin.selectionMode = true;

    await viewer.loadStructureFromUrl(
        'https://models.rcsb.org/1crn.bcif',
        'mmcif',
        true,
    );
}

void bootstrap();
