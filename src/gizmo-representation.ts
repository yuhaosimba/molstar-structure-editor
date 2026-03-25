import { Mesh } from 'molstar/lib/mol-geo/geometry/mesh/mesh';
import { MeshBuilder } from 'molstar/lib/mol-geo/geometry/mesh/mesh-builder';
import { addCylinder } from 'molstar/lib/mol-geo/geometry/mesh/builder/cylinder';
import { addSphere } from 'molstar/lib/mol-geo/geometry/mesh/builder/sphere';
import { Circle } from 'molstar/lib/mol-geo/primitive/circle';
import { transformPrimitive } from 'molstar/lib/mol-geo/primitive/primitive';
import { Sphere3D } from 'molstar/lib/mol-math/geometry';
import { Mat4, Vec3 } from 'molstar/lib/mol-math/linear-algebra';
import { Shape } from 'molstar/lib/mol-model/shape';
import { Task } from 'molstar/lib/mol-task';
import { Color } from 'molstar/lib/mol-util/color';
import { ColorNames } from 'molstar/lib/mol-util/color/names';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition';
import { PluginStateObject as SO, PluginStateTransform } from 'molstar/lib/mol-plugin-state/objects';
import { StateTransformer } from 'molstar/lib/mol-state';

export type GizmoHandleId = 'translate-x' | 'translate-y' | 'translate-z' | 'rotate-x' | 'rotate-y' | 'rotate-z' | 'center';

export const GizmoGroupIds: GizmoHandleId[] = [
    'translate-x',
    'translate-y',
    'translate-z',
    'rotate-x',
    'rotate-y',
    'rotate-z',
    'center',
];

export const StructureEditorGizmoParams = {
    visible: PD.Boolean(false),
    anchor: PD.Vec3(Vec3.zero()),
    scale: PD.Numeric(1, { min: 0.1, max: 1000, step: 0.1 }),
    activeHandle: PD.Text('', { isHidden: true }),
};
export type StructureEditorGizmoParams = typeof StructureEditorGizmoParams
export type StructureEditorGizmoProps = PD.Values<StructureEditorGizmoParams>

const AxisColors = [ColorNames.red, ColorNames.green, ColorNames.blue] as const;

function addAxis(mesh: MeshBuilder.State, start: Vec3, end: Vec3, radius: number, group: number) {
    mesh.currentGroup = group;
    addCylinder(mesh, start, end, 1, { radiusTop: radius, radiusBottom: radius, radialSegments: 28 });
    addSphere(mesh, end, radius * 2.1, 2);
}

function circleTransform(axis: Vec3, anchor: Vec3, radius: number) {
    const t = Mat4.identity();
    if (axis[0] === 1) {
        Mat4.mul(t, Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.unitY), t);
    } else if (axis[1] === 1) {
        Mat4.mul(t, Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.unitX), t);
    }
    Mat4.scaleUniformly(t, t, radius);
    Mat4.setTranslation(t, anchor);
    return t;
}

function addRing(mesh: MeshBuilder.State, axis: Vec3, anchor: Vec3, radius: number, tubeRadius: number, group: number) {
    const primitive = transformPrimitive(Circle({ radius: 1, segments: 96 }), circleTransform(axis, anchor, radius));
    mesh.currentGroup = group;
    const { indices, vertices } = primitive;
    const a = Vec3.zero();
    const b = Vec3.zero();
    for (let i = 0, il = indices.length; i < il; i += 3) {
        const ia = indices[i] * 3;
        const ib = indices[i + 1] * 3;
        Vec3.set(a, vertices[ia], vertices[ia + 1], vertices[ia + 2]);
        Vec3.set(b, vertices[ib], vertices[ib + 1], vertices[ib + 2]);
        addCylinder(mesh, a, b, 1, { radiusTop: tubeRadius, radiusBottom: tubeRadius, radialSegments: 20 });
    }
}

function createGizmoMesh(data: StructureEditorGizmoProps, oldMesh?: Mesh) {
    const state = MeshBuilder.createState(2048, 1024, oldMesh);
    if (!data.visible) return Mesh.createEmpty(oldMesh);

    const anchor = Vec3.clone(data.anchor);
    const axisLength = data.scale;
    const ringRadius = data.scale * 0.9;
    const axisRadius = Math.max(data.scale * 0.06, 0.08);
    const ringRadiusTube = Math.max(data.scale * 0.04, 0.05);

    addAxis(state, anchor, Vec3.add(Vec3(), anchor, Vec3.create(axisLength, 0, 0)), axisRadius, 0);
    addAxis(state, anchor, Vec3.add(Vec3(), anchor, Vec3.create(0, axisLength, 0)), axisRadius, 1);
    addAxis(state, anchor, Vec3.add(Vec3(), anchor, Vec3.create(0, 0, axisLength)), axisRadius, 2);

    addRing(state, Vec3.unitX, anchor, ringRadius, ringRadiusTube, 3);
    addRing(state, Vec3.unitY, anchor, ringRadius, ringRadiusTube, 4);
    addRing(state, Vec3.unitZ, anchor, ringRadius, ringRadiusTube, 5);

    state.currentGroup = 6;
    addSphere(state, anchor, axisRadius * 2.5, 3);

    const mesh = MeshBuilder.getMesh(state);
    mesh.setBoundingSphere(Sphere3D.create(anchor, data.scale * 1.5));
    return mesh;
}

export type StructureEditorGizmo3D = typeof StructureEditorGizmo3D
export const StructureEditorGizmo3D = PluginStateTransform.BuiltIn({
    name: 'structure-editor-gizmo-3d',
    display: { name: 'Structure Editor Gizmo' },
    from: SO.Root,
    to: SO.Shape.Provider,
    params: StructureEditorGizmoParams
})({
    canAutoUpdate: () => true,
    apply({ params }) {
        return Task.create('Structure Editor Gizmo', async () => {
            return new SO.Shape.Provider({
                label: 'Structure Editor Gizmo',
                data: params,
                params: Mesh.Params,
                getShape: (_, data: StructureEditorGizmoProps, __, shape) => Shape.create(
                    'Structure Editor Gizmo',
                    { tag: 'structure-editor-gizmo' },
                    createGizmoMesh(data, shape?.geometry),
                    groupId => {
                        if (groupId === 6) return ColorNames.lightgrey;
                        return AxisColors[groupId % 3];
                    },
                    () => 1,
                    groupId => GizmoGroupIds[groupId] ?? 'gizmo'
                ),
                geometryUtils: Mesh.Utils
            }, { label: 'Structure Editor Gizmo' });
        });
    },
    update({ b, newParams }) {
        b.data.data = newParams;
        return StateTransformer.UpdateResult.Updated;
    }
});
