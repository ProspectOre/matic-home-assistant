"""Build the original Matic-shaped marker and its Cycles sprite atlas.

Run with Blender 4.5 LTS and cwebp on PATH:
    blender -b -P scripts/robot_model/build_robot.py

Pillow (the project's Python dependency) packs the rendered layers. Use -- after
Blender's arguments for --work-dir, --python, --samples or --preview. Preview
renders accept --preview-resolution and also produce 128px samples. No .blend,
photographs, vendor meshes, textures or logos are used or saved. Dimensions are
from https://maticrobots.com/product; geometry is constructed below in meters.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "custom_components/matic_robot/map_studio_v4/assets"
FRAME = 128
HEADINGS = 32
PITCHES = (90, 55, 25)
FRAME_METERS = 0.66
LENGTH_METERS = 0.406
BODY_LENGTH = 0.2794
BODY_WIDTH = 0.23876
BODY_X = -0.057
WHEEL_X = 0.010
WHEEL_Z = 0.079
WHEEL_RADIUS = 0.079
WHEEL_WIDTH = 0.021


def material(name, color, roughness, metallic=0):
    """Use physically based surfaces, with no external texture inputs."""
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return result


def finish(obj, name, surface, bevel=0):
    obj.name = name
    obj.data.materials.append(surface)
    if bevel:
        edge = obj.modifiers.new("Moulded edge", "BEVEL")
        edge.width = bevel
        edge.segments = 6
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.modifiers.new("Surface normals", "WEIGHTED_NORMAL")
    return obj


def box(name, location, size, surface, bevel):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, surface, bevel)


def cylinder(name, location, radius, depth, surface, axis="Y", bevel=0.001):
    rotation = {
        "X": (0, math.pi / 2, 0),
        "Y": (math.pi / 2, 0, 0),
        "Z": (0, 0, 0),
    }[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=96,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return finish(bpy.context.object, name, surface, bevel)


def rounded_outline(length, width, radius):
    """An original rounded-rectangle section, independent of vertical bevels."""
    outline = []
    for corner, (x, y) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        for step in range(13):
            angle = (corner + step / 12) * math.pi / 2
            outline.append(
                (
                    x * (length / 2 - radius) + radius * math.cos(angle),
                    y * (width / 2 - radius) + radius * math.sin(angle),
                )
            )
    return outline


def loft(name, rings, surface, bevel=0):
    """Join matching perimeter rings, then orient all normals outwards."""
    count = len(rings[0])
    vertices = [vertex for ring in rings for vertex in ring]
    faces = [tuple(reversed(range(count)))]
    faces.append(tuple(range((len(rings) - 1) * count, len(rings) * count)))
    for level in range(len(rings) - 1):
        offset = level * count
        faces.extend(
            (
                offset + i,
                offset + (i + 1) % count,
                offset + (i + 1) % count + count,
                offset + i + count,
            )
            for i in range(count)
        )
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    edit = bmesh.new()
    edit.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(edit, faces=list(edit.faces))
    edit.to_mesh(mesh)
    edit.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, surface, bevel)


def rounded_lid(name, location, size, radius, surface, bevel=0.001):
    """Round the footprint without collapsing the height of the camera deck."""
    length, width, height = size
    outline = rounded_outline(length, width, radius)
    obj = loft(
        name,
        [[(x, y, z) for x, y in outline] for z in (-height / 2, height / 2)],
        surface,
        bevel,
    )
    obj.location = location
    return obj


def carve(obj, cutter):
    """Apply a real recess before edge rounding; never hide a tire in a box."""
    bpy.context.view_layer.objects.active = obj
    cut = obj.modifiers.new("Moulded recess", "BOOLEAN")
    cut.operation, cut.solver, cut.object = "DIFFERENCE", "EXACT", cutter
    bpy.ops.object.modifier_move_to_index(modifier=cut.name, index=0)
    bpy.ops.object.modifier_apply(modifier=cut.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def curved_profile(segments):
    """Sample original cubic sections for the neck and roller housing."""
    points = []
    for start, control_a, control_b, end in segments:
        for step in range(12):
            t = step / 12
            points.append(
                tuple(
                    (1 - t) ** 3 * start[axis]
                    + 3 * (1 - t) ** 2 * t * control_a[axis]
                    + 3 * (1 - t) * t**2 * control_b[axis]
                    + t**3 * end[axis]
                    for axis in (0, 1)
                )
            )
    return points


def transverse_shell(name, profile, sections, surface, bevel=0):
    center_x = (min(x for x, _ in profile) + max(x for x, _ in profile)) / 2
    center_z = (min(z for _, z in profile) + max(z for _, z in profile)) / 2
    return loft(
        name,
        [
            [
                (
                    center_x + (x - center_x) * scale,
                    y,
                    center_z + (z - center_z) * scale,
                )
                for x, z in profile
            ]
            for y, scale in sections
        ],
        surface,
        bevel,
    )


def optical_lens(name, location, radius, surface, axis):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=48, ring_count=24, radius=radius, location=location
    )
    obj = bpy.context.object
    obj.scale = (0.23, 1, 1) if axis == "X" else (1, 1, 0.23)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, surface)


def make_robot():
    white = material("Warm satin moulded polymer", (0.82, 0.813, 0.79), 0.32)
    rubber = material("Soft charcoal rubber", (0.018, 0.020, 0.022), 0.72)
    band = material("Charcoal camera chassis", (0.017, 0.019, 0.021), 0.39)
    glass = material("Dark sensor window", (0.011, 0.015, 0.019), 0.19)
    lens = material("Optical glass", (0.012, 0.022, 0.030), 0.055, 0.18)
    grey = material("Neutral recessed lid seam", (0.19, 0.20, 0.20), 0.46)
    control = material("Unmarked control surface", (0.065, 0.068, 0.071), 0.42)
    rim = material("Fine control ring", (0.56, 0.57, 0.56), 0.31, 0.12)
    # Published body: 11 x 9.4 x 7.8 inches. The lower shell curves inward
    # underneath; wheel openings are cut through its full-width outer sides.
    shell = loft(
        "Shaped white body shell",
        [
            [(BODY_X + x, y, z) for x, y in rounded_outline(length, width, radius)]
            for z, length, width, radius in (
                (0.024, 0.246, 0.215, 0.036),
                (0.028, 0.260, 0.229, 0.037),
                (0.040, 0.275, 0.237, 0.039),
                (0.063, BODY_LENGTH, BODY_WIDTH, 0.040),
                (0.169, BODY_LENGTH, BODY_WIDTH, 0.040),
                (0.171, BODY_LENGTH - 0.001, BODY_WIDTH - 0.001, 0.040),
            )
        ],
        white,
        0.0012,
    )
    for side in (-1, 1):
        cutter = cylinder(
            "Wheel well cutter",
            (WHEEL_X, side * 0.125, WHEEL_Z),
            0.0825,
            0.064,
            rubber,
            bevel=0,
        )
        carve(shell, cutter)
        cylinder(
            "Recessed wheel well lining",
            (WHEEL_X, side * 0.0942, WHEEL_Z),
            0.0815,
            0.001,
            rubber,
            bevel=0.0003,
        )
    # A true U-shaped opening, open below, leaves the front shoulders around
    # the tires and daylight around the separate articulated neck.
    recess = box(
        "Front neck recess cutter",
        (0.081, 0, 0.018),
        (0.074, 0.115, 0.137),
        rubber,
        0.010,
    )
    bpy.context.view_layer.objects.active = recess
    bpy.ops.object.modifier_apply(modifier="Moulded edge")
    carve(shell, recess)
    box("Recess interior", (0.0444, 0, 0.049), (0.001, 0.100, 0.059), rubber, 0.004)
    # The lower rear support is largely hidden in the map views.
    box("Rear underbody", (-0.149, 0, 0.026), (0.055, 0.145, 0.009), rubber, 0.004)
    for y in (-0.070, 0.070):
        cylinder("Small rear support roller", (-0.157, y, 0.012), 0.011, 0.012, rubber)

    deck = rounded_lid(
        "Continuous camera chassis",
        (BODY_X, 0, 0.1842),
        (BODY_LENGTH, BODY_WIDTH, 0.0278),
        0.040,
        band,
        0.0013,
    )
    # The lid sits in a shallow pocket. Its front edge leaves a broad camera
    # and control deck rather than an oversized white plate above a black rim.
    pocket = rounded_lid(
        "Lid pocket cutter",
        (-0.072, 0, 0.201),
        (0.2295, 0.208, 0.017),
        0.035,
        band,
        0,
    )
    carve(deck, pocket)
    seam = rounded_lid(
        "Tintable recessed lid seam",
        (-0.072, 0, 0.1945),
        (0.2255, 0.204, 0.002),
        0.033,
        grey,
        0.0005,
    )
    seam.pass_index = 1
    rounded_lid(
        "Inset satin lid",
        (-0.072, 0, 0.1947),
        (0.2235, 0.202, 0.0032),
        0.032,
        white,
        0.0009,
    )
    box(
        "Recessed rear lid hinge",
        (-0.184, 0, 0.195),
        (0.004, 0.032, 0.002),
        grey,
        0.0007,
    )

    # Wheels are forward of the body centre. Tire, tread and flat hub faces
    # stay inside the exact same lateral envelope as the upper chassis.
    wheel_parts = []
    for side in (-1, 1):
        y = side * (BODY_WIDTH / 2 - WHEEL_WIDTH / 2)
        tire = cylinder(
            "Rubber wheel sidewall",
            (WHEEL_X, y, WHEEL_Z),
            WHEEL_RADIUS - 0.0011,
            WHEEL_WIDTH,
            rubber,
            bevel=0.001,
        )
        carve(
            tire,
            cylinder(
                "Wheel hub recess cutter",
                (WHEEL_X, y, WHEEL_Z),
                0.07095,
                WHEEL_WIDTH + 0.010,
                rubber,
                bevel=0,
            ),
        )
        wheel_parts.append(tire)
        wheel_parts.append(
            cylinder(
                "Flat light wheel hub",
                (WHEEL_X, side * (BODY_WIDTH / 2 - 0.0012), WHEEL_Z),
                0.0707,
                0.002,
                white,
                bevel=0.00045,
            )
        )
        for i in range(64):
            angle = i * math.tau / 64
            tread = box(
                "Wheel tread rib",
                (
                    WHEEL_X + math.sin(angle) * (WHEEL_RADIUS - 0.001),
                    y,
                    WHEEL_Z + math.cos(angle) * (WHEEL_RADIUS - 0.001),
                ),
                (0.0046, WHEEL_WIDTH - 0.0004, 0.0018),
                rubber,
                0.00035,
            )
            tread.rotation_euler.y = angle
            wheel_parts.append(tread)

    front_x = BODY_X + BODY_LENGTH / 2
    for y in (-0.052, 0.052):
        cylinder(
            "Inset front camera bezel",
            (front_x, y, 0.184),
            0.0094,
            0.002,
            rubber,
            "X",
            0.0007,
        )
        cylinder(
            "Front lens inner rim",
            (front_x + 0.001, y, 0.184),
            0.0069,
            0.0008,
            band,
            "X",
            0.0003,
        )
        optical_lens(
            "Front camera glass", (front_x + 0.0015, y, 0.184), 0.0061, lens, "X"
        )
    box(
        "Central front sensor window",
        (front_x + 0.0007, 0, 0.1835),
        (0.0014, 0.058, 0.010),
        glass,
        0.004,
    )
    cylinder(
        "Top camera countersink",
        (0.053, -0.079, 0.198),
        0.011,
        0.001,
        rubber,
        "Z",
        0.0004,
    )
    cylinder(
        "Top optical socket", (0.053, -0.079, 0.1984), 0.0072, 0.0008, band, "Z", 0.0003
    )
    optical_lens("Top camera glass", (0.053, -0.079, 0.1989), 0.006, lens, "Z")
    cylinder(
        "Control perimeter ring",
        (0.053, 0.079, 0.1982),
        0.0108,
        0.0008,
        rim,
        "Z",
        0.0002,
    )
    cylinder(
        "Unmarked recessed control",
        (0.053, 0.079, 0.19865),
        0.0098,
        0.0004,
        control,
        "Z",
        0.00015,
    )
    cylinder(
        "Secondary round control",
        (0.041, 0.102, 0.1982),
        0.006,
        0.0007,
        control,
        "Z",
        0.0002,
    )

    neck_profile = curved_profile(
        (
            ((0.050, 0.076), (0.062, 0.077), (0.071, 0.077), (0.075, 0.066)),
            ((0.075, 0.066), (0.079, 0.052), (0.084, 0.048), (0.101, 0.047)),
            ((0.101, 0.047), (0.111, 0.047), (0.119, 0.044), (0.121, 0.039)),
            ((0.121, 0.039), (0.125, 0.028), (0.119, 0.020), (0.109, 0.020)),
            ((0.109, 0.020), (0.073, 0.022), (0.054, 0.038), (0.050, 0.051)),
            ((0.050, 0.051), (0.047, 0.063), (0.047, 0.073), (0.050, 0.076)),
        )
    )
    transverse_shell(
        "Curved articulated neck",
        neck_profile,
        [
            (-0.049, 0.91),
            (-0.048, 0.98),
            (-0.045, 1),
            (0.045, 1),
            (0.048, 0.98),
            (0.049, 0.91),
        ],
        white,
    )

    # An original curved roller-housing section, with separate rounded endcaps.
    # Its lower front is opened to expose the dark intake and contact roller.
    head_profile = curved_profile(
        (
            ((0.105, 0.025), (0.105, 0.012), (0.109, 0.003), (0.124, 0.003)),
            ((0.124, 0.003), (0.145, 0.003), (0.175, 0.003), (0.190, 0.005)),
            ((0.190, 0.005), (0.205, 0.007), (0.209, 0.015), (0.209, 0.030)),
            ((0.209, 0.030), (0.209, 0.055), (0.204, 0.067), (0.189, 0.074)),
            ((0.189, 0.074), (0.172, 0.081), (0.142, 0.079), (0.124, 0.077)),
            ((0.124, 0.077), (0.108, 0.076), (0.105, 0.068), (0.105, 0.054)),
            ((0.105, 0.054), (0.105, 0.044), (0.105, 0.034), (0.105, 0.025)),
        )
    )
    head = transverse_shell(
        "Convex cleaning head housing",
        head_profile,
        [(-0.0995, 1), (0.0995, 1)],
        white,
        0.0006,
    )
    carve(
        head,
        box(
            "Lower intake cutter",
            (0.205, 0, 0.007),
            (0.043, 0.201, 0.028),
            rubber,
            0,
        ),
    )
    for side in (-1, 1):
        sections = [
            (side * y, scale)
            for y, scale in (
                (0.1001, 1),
                (0.108, 1),
                (0.114, 0.97),
                (0.118, 0.88),
                (BODY_WIDTH / 2, 0.79),
            )
        ]
        transverse_shell("Rounded head endcap", head_profile, sorted(sections), white)
    box("Recessed head intake", (0.187, 0, 0.014), (0.016, 0.198, 0.016), rubber, 0.002)
    cylinder(
        "Head contact roller", (0.196, 0, 0.010), 0.008, 0.194, rubber, bevel=0.0005
    )
    box(
        "Fine rubber intake lip",
        (0.207, 0, 0.021),
        (0.003, 0.198, 0.002),
        rubber,
        0.0005,
    )

    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    for part in wheel_parts:
        evaluated = part.evaluated_get(graph)
        if any(
            abs((evaluated.matrix_world @ Vector(corner)).y) > BODY_WIDTH / 2 + 1e-6
            for corner in evaluated.bound_box
        ):
            raise RuntimeError(f"Wheel protrudes beyond chassis: {part.name}")
    print("Validated flush wheel envelope with open side wheel wells", flush=True)
    robot = bpy.data.objects.new("Robot heading", None)
    bpy.context.collection.objects.link(robot)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in meshes:
        obj.parent = robot
    return robot, meshes


def make_shadow_floor(meshes):
    """Cycles ray-traced ambient occlusion, stored as a separate black alpha tile."""
    surface = bpy.data.materials.new("Contact occlusion")
    surface.use_nodes = True
    nodes = surface.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    ao = nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.06
    ao.samples = 32
    inverse = nodes.new("ShaderNodeMath")
    inverse.operation = "SUBTRACT"
    inverse.inputs[0].default_value = 1
    strength = nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = 0.35
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    black = nodes.new("ShaderNodeEmission")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    mix = nodes.new("ShaderNodeMixShader")
    links = surface.node_tree.links
    links.new(ao.outputs["AO"], inverse.inputs[1])
    links.new(inverse.outputs[0], strength.inputs[0])
    links.new(strength.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(black.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs["Surface"])
    # Contact occlusion cannot reach beyond the model's horizontal radius plus
    # the AO ray length. A finite receiver avoids sampling an unoccluded floor
    # across the whole transparent tile, while retaining every possible shadow.
    radius = (
        max(
            math.hypot(point.x, point.y)
            for mesh in meshes
            for corner in mesh.bound_box
            for point in (mesh.matrix_world @ Vector(corner),)
        )
        + ao.inputs["Distance"].default_value
    )
    bpy.ops.mesh.primitive_circle_add(
        vertices=128, radius=radius, fill_type="NGON", location=(0, 0, -0.0005)
    )
    floor = bpy.context.object
    floor.name = "Contact shadow receiver"
    floor.data.materials.append(surface)
    return floor


def configure_scene(work, samples, resolution=FRAME * 2):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.seed = 84
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.world.color = (0.35, 0.35, 0.35)
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = FRAME_METERS
    scene.camera = camera
    for name, location, power, size in (
        ("Upper-left softbox", (-0.6, -0.7, 1.0), 55, 0.7),
        ("Soft fill", (0.6, 0.1, 0.5), 9, 0.8),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy, light.data.shape, light.data.size = power, "DISK", size
        light.rotation_euler = (-light.location).to_track_quat("-Z", "Y").to_euler()
    scene.use_nodes = True
    nodes = scene.node_tree.nodes
    nodes.clear()
    layers = nodes.new("CompositorNodeRLayers")
    scene.view_layers[0].use_pass_object_index = True
    composite = nodes.new("CompositorNodeComposite")
    scene.node_tree.links.new(layers.outputs["Image"], composite.inputs[0])
    mask = nodes.new("CompositorNodeIDMask")
    mask.index = 1
    mask.use_antialiasing = True
    scene.node_tree.links.new(layers.outputs["IndexOB"], mask.inputs[0])
    alpha = nodes.new("CompositorNodeSetAlpha")
    alpha.inputs["Image"].default_value = (1, 1, 1, 1)
    scene.node_tree.links.new(mask.outputs["Alpha"], alpha.inputs["Alpha"])
    output = nodes.new("CompositorNodeOutputFile")
    output.base_path = str(work)
    output.format.file_format, output.format.color_mode = "PNG", "RGBA"
    scene.node_tree.links.new(alpha.outputs[0], output.inputs[0])
    return scene, camera, output


def set_view(scene, camera, robot, pitch, screen_angle):
    camera.location = (0, -2 * math.cos(pitch), 2 * math.sin(pitch))
    # Track-to has an ambiguous roll at the pole. This basis keeps +x right
    # and world +y up in the top view, continuously through all three pitches.
    camera.rotation_euler = (math.pi / 2 - pitch, 0, 0)
    robot.rotation_euler.z = math.atan2(
        -math.sin(screen_angle) / math.sin(pitch), math.cos(screen_angle)
    )
    for name, offset in (
        ("Upper-left softbox", (-0.6, 0.8, 1.0)),
        ("Soft fill", (0.6, 0.1, 0.5)),
    ):
        light = bpy.data.objects[name]
        light.location = camera.rotation_euler.to_matrix() @ Vector(offset)
        light.rotation_euler = (-light.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()


def check_projection(scene, camera, robot, meshes, expected):
    """Check the actual camera, not the frame label or its angle calculation."""
    origin = world_to_camera_view(scene, camera, Vector((0, 0, 0)))
    front = world_to_camera_view(
        scene, camera, robot.matrix_world @ Vector((0.2, 0, 0))
    )
    actual = math.atan2(origin.y - front.y, front.x - origin.x)
    error = math.atan2(math.sin(actual - expected), math.cos(actual - expected))
    if abs(error) > 1e-5 or abs(origin.x - 0.5) + abs(origin.y - 0.5) > 1e-5:
        raise RuntimeError(
            f"Camera heading/ground anchor mismatch: {actual}, {expected}"
        )
    graph = bpy.context.evaluated_depsgraph_get()
    margin = 8 / (FRAME * 2)
    for mesh in meshes:
        evaluated = mesh.evaluated_get(graph)
        for corner in evaluated.bound_box:
            point = world_to_camera_view(
                scene, camera, evaluated.matrix_world @ Vector(corner)
            )
            if not (margin < point.x < 1 - margin and margin < point.y < 1 - margin):
                raise RuntimeError(f"Clipped geometry: {mesh.name}, {tuple(point)}")


PACK = """
import sys
from pathlib import Path
from PIL import Image, ImageFilter
work = Path(sys.argv[1])
atlas = Image.new('RGBA', (4096, 1152))
for pitch in range(3):
    for heading in range(32):
        index = pitch * 32 + heading
        for layer, name in enumerate(('body', 'shadow', 'accent')):
            suffix = '-0001' if name == 'accent' else ''
            with Image.open(work / f'{name}-{index:03d}{suffix}.png') as frame:
                tile = frame.convert('RGBA').resize((128,128), Image.Resampling.LANCZOS)
                alpha = tile.getchannel('A')
                if name == 'shadow':
                    # Remove sub-visible sampling noise in otherwise clear floor.
                    alpha = alpha.point(lambda value: 0 if value < 3 else value)
                    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
                # Thirty-two alpha levels preserve soft edges while keeping
                # the lossless alpha stream smaller than the colour image.
                alpha = alpha.point(lambda value: min(255, round(value / 8) * 8))
                tile.putalpha(alpha)
                bounds = alpha.getbbox()
                if bounds is None:
                    raise RuntimeError(f'Empty {name} frame {index}')
                if name != 'shadow' and not all((bounds[0] >= 3, bounds[1] >= 3,
                                                bounds[2] <= 125, bounds[3] <= 125)):
                    raise RuntimeError(f'Clipped {name} frame {index}: {bounds}')
                if name == 'shadow':
                    corners = [(0,0,8,8),(120,0,128,8),(0,120,8,128),(120,120,128,128)]
                    if any(alpha.crop(corner).getextrema()[1] for corner in corners):
                        raise RuntimeError(f'Shadow outside contact: {index}')
                atlas.paste(tile, (heading*128, (layer*3+pitch)*128))
atlas.save(work / 'atlas.png')
"""


PREVIEW = """
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
work = Path(sys.argv[1])
sheet = Image.new('RGB', (456, 510), '#e4e8eb')
draw = ImageDraw.Draw(sheet)
for row, pitch in enumerate((90, 55, 25)):
    for col, heading in enumerate((0, 4, 8)):
        index = row * 32 + heading
        body = Image.open(work / f'body-{index:03d}.png').convert('RGBA')
        shadow = Image.open(work / f'shadow-{index:03d}.png').convert('RGBA')
        alpha = shadow.getchannel('A').point(lambda value: 0 if value < 3 else value)
        size = body.width
        corner = max(8, size // 16)
        corners = ((0, 0, corner, corner), (size-corner, 0, size, corner),
                   (0, size-corner, corner, size),
                   (size-corner, size-corner, size, size))
        for bounds in corners:
            if alpha.crop(bounds).getextrema()[1]:
                raise RuntimeError(f'Shadow outside contact in preview {index}')
        shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(size / 160)))
        Image.alpha_composite(shadow, body).save(work / f'preview-{index:03d}.png')
        layers = []
        for name in ('shadow', 'body', 'accent'):
            suffix = '-0001' if name == 'accent' else ''
            tile = Image.open(work / f'{name}-{index:03d}{suffix}.png').convert('RGBA')
            tile = tile.resize((128, 128), Image.Resampling.LANCZOS)
            tile_alpha = tile.getchannel('A')
            if name == 'shadow':
                tile_alpha = tile_alpha.point(lambda value: 0 if value < 3 else value)
                tile_alpha = tile_alpha.filter(ImageFilter.GaussianBlur(0.8))
            tile_alpha = tile_alpha.point(lambda value: min(255, round(value / 8) * 8))
            bounds = tile_alpha.getbbox()
            if bounds is None:
                raise RuntimeError(f'Empty preview {name} {index}')
            if name != 'shadow' and not all((bounds[0] >= 3, bounds[1] >= 3,
                                            bounds[2] <= 125, bounds[3] <= 125)):
                raise RuntimeError(f'Clipped preview {name} {index}: {bounds}')
            tile.putalpha(tile_alpha)
            tile.save(work / f'sample-{name}-{index:03d}.png')
            layers.append(tile)
        sample = Image.alpha_composite(layers[0], layers[1])
        sample.save(work / f'sample-{index:03d}.png')
        sheet.paste(sample, (12 + col * 152, 8 + row * 170), sample)
        draw.text((12 + col * 152, 139 + row * 170),
                  f'{pitch} deg / frame {heading}', fill='#30373c')
sheet.save(work / 'samples-128.png')
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--samples", type=int, default=48)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--preview-resolution", type=int, default=768)
    parser.add_argument("--pack-only", action="store_true")
    parser.add_argument("--python", default=str(ROOT / ".venv/bin/python"))
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    if args.preview and args.pack_only:
        parser.error("--preview and --pack-only are mutually exclusive")
    if args.preview and args.work_dir is None:
        parser.error("--preview requires --work-dir to retain the rendered previews")
    if args.preview_resolution < FRAME or args.samples < 1:
        parser.error(
            "Preview resolution must be at least 128; samples must be positive"
        )
    encoder = shutil.which("cwebp")
    if not encoder:
        raise RuntimeError("Install libwebp's cwebp before building the atlas")
    with tempfile.TemporaryDirectory(prefix="matic-robot-") as temporary:
        work = args.work_dir or Path(temporary)
        work.mkdir(parents=True, exist_ok=True)
        if not args.pack_only:
            scene, camera, mask_output = configure_scene(
                work,
                args.samples,
                args.preview_resolution if args.preview else FRAME * 2,
            )
            robot, meshes = make_robot()
            floor = make_shadow_floor(meshes)
            for degrees in PITCHES:
                for heading in range(HEADINGS):
                    expected = heading * math.tau / HEADINGS
                    set_view(scene, camera, robot, math.radians(degrees), expected)
                    check_projection(scene, camera, robot, meshes, expected)
            print(
                "Validated projection, ground anchor and margin for all 96 frames",
                flush=True,
            )
            for pitch_index, degrees in enumerate(PITCHES):
                pitch = math.radians(degrees)
                for heading in [0, 4, 8] if args.preview else range(HEADINGS):
                    index = pitch_index * HEADINGS + heading
                    screen_angle = heading * math.tau / HEADINGS
                    # Uniform screen headings: undo the pitch foreshortening.
                    # Index 0 faces screen +x; positive indices turn clockwise.
                    set_view(scene, camera, robot, pitch, screen_angle)
                    floor.hide_render = True
                    for mesh in meshes:
                        mesh.visible_camera = True
                    scene.use_nodes = True
                    mask_output.file_slots[0].path = f"accent-{index:03d}-"
                    scene.render.filepath = str(work / f"body-{index:03d}.png")
                    bpy.ops.render.render(write_still=True)
                    scene.use_nodes = False
                    floor.hide_render = False
                    for mesh in meshes:
                        mesh.visible_camera = False
                    scene.render.filepath = str(work / f"shadow-{index:03d}.png")
                    bpy.ops.render.render(write_still=True)
                    print(f"ROBOT_FRAME {index + 1}/96 pitch={degrees}", flush=True)
        if args.preview:
            subprocess.run([args.python, "-c", PREVIEW, str(work)], check=True)
            print(f"Preview layers: {work}")
            return
        subprocess.run([args.python, "-c", PACK, str(work)], check=True)
        atlas = work / "robot-atlas.webp"
        subprocess.run(
            [
                encoder,
                "-quiet",
                "-q",
                "85",
                "-alpha_q",
                "80",
                "-m",
                "6",
                "-sharp_yuv",
                str(work / "atlas.png"),
                "-o",
                str(atlas),
            ],
            check=True,
        )
        if atlas.stat().st_size >= 250_000:
            raise RuntimeError(f"Atlas exceeds 250 KB: {atlas.stat().st_size} bytes")
        OUTPUT.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(atlas, OUTPUT / atlas.name)
        metadata = {
            "frameSize": FRAME,
            "headings": HEADINGS,
            "headingStep": 11.25,
            "pitches": PITCHES,
            "columns": HEADINGS,
            "layers": {"body": 0, "shadow": 3, "accent": 6},
            "frameMeters": FRAME_METERS,
            "lengthMeters": LENGTH_METERS,
            "anchor": [0.5, 0.5],
            "headingDirection": "clockwise-screen",
            "renderer": (
                f"Blender {bpy.app.version_string}, Cycles, {args.samples} samples"
            ),
        }
        (OUTPUT / "robot-atlas.json").write_text(json.dumps(metadata, indent=2) + "\n")
        print(f"Atlas: {atlas.stat().st_size} bytes; {OUTPUT / atlas.name}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        # Blender otherwise prints Python exceptions and exits successfully.
        sys.exit(1)
