import { Viewer } from 'molstar/lib/apps/viewer/app';
import {
    enableStructureEditing,
    registerStructureEditor,
} from '../../src/index';

const benzeneUrl = new URL('./assets/benzene.mol', import.meta.url).href;
const proteinUrl = 'https://models.rcsb.org/1crn.bcif';

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

    const loadSample = async (kind: 'protein' | 'ligand') => {
        await viewer.plugin.clear();
        viewer.plugin.managers.interactivity.setProps({ granularity: 'element' });
        viewer.plugin.selectionMode = true;

        if (kind === 'ligand') {
            await viewer.loadStructureFromUrl(benzeneUrl, 'mol', false, { label: 'Ligand: Benzene' });
            const structures = viewer.plugin.managers.structure.hierarchy.current.structures;
            await viewer.plugin.managers.structure.component.applyPreset(structures, 'atomic-detail' as any);
            return;
        }

        await viewer.loadStructureFromUrl(proteinUrl, 'mmcif', true, { label: 'Protein: 1CRN' });
    };

    const mountSampleBar = () => {
        const host = viewer.plugin.canvas3dContext?.canvas?.parentElement;
        if (!host) return;

        const bar = document.createElement('div');
        bar.style.position = 'absolute';
        bar.style.top = '12px';
        bar.style.right = '12px';
        bar.style.display = 'flex';
        bar.style.gap = '8px';
        bar.style.padding = '8px';
        bar.style.background = 'rgba(0, 0, 0, 0.65)';
        bar.style.borderRadius = '8px';
        bar.style.zIndex = '20';

        const title = document.createElement('span');
        title.textContent = 'Samples';
        title.style.color = '#fff';
        title.style.fontSize = '12px';
        title.style.alignSelf = 'center';
        title.style.marginRight = '4px';
        bar.appendChild(title);

        const buttons = [
            ['Protein', () => loadSample('protein')],
            ['Ligand', () => loadSample('ligand')],
        ] as const;

        for (const [label, action] of buttons) {
            const button = document.createElement('button');
            button.textContent = label;
            button.style.border = 'none';
            button.style.padding = '6px 10px';
            button.style.borderRadius = '6px';
            button.style.cursor = 'pointer';
            button.addEventListener('click', () => void action());
            bar.appendChild(button);
        }

        host.style.position ||= 'relative';
        host.appendChild(bar);
    };

    mountSampleBar();
    await loadSample('ligand');
}

void bootstrap();
