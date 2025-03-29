const imageUpload = document.getElementById('imageUpload');
const mainCanvas = document.getElementById('mainCanvas');
const ctx = mainCanvas.getContext('2d');
const uploadNewButton = document.getElementById('uploadNew');
const resetButton = document.getElementById('resetCanvas');
const cutToolButton = document.getElementById('cutTool');
const pickupToolButton = document.getElementById('pickupTool');
const drawToolButton = document.getElementById('drawTool');

// Create resize tool button
const resizeToolButton = document.createElement('button');
resizeToolButton.id = 'resizeTool';
resizeToolButton.className = 'tool-button';
resizeToolButton.textContent = 'Resize Tool';
document.querySelector('.tool-buttons').appendChild(resizeToolButton);

// Access Matter.js modules
const { Engine, Render, World, Bodies, Body, Vertices, Vector, Composite, MouseConstraint, Mouse, Query, Constraint } = Matter;

// Canvas dimensions
const canvasWidth = 1000;
const canvasHeight = 700;

// Variables
let images = [];
let engine;
let world;
let mouseConstraint;
let cutPieces = [];
let isDrawing = false;
let currentTool = 'cut';
let currentNeonPath = [];
let finishedNeonLines = [];
let drawingColor = '#00ffff';
let permanentDrawings = [];
let selectedBody = null;
let grabConstraint = null;
let resizeSlider = null;

// New variables for improved cutting
const minCutDistance = 5;
let lastCutPoint = null;
let cutIntensity = 0;

// Color and style settings
const neonLineWidth = 5;
const neonShadowBlur = 15;

// Available drawing colors
const colorOptions = [
    '#00ffff', '#ff00ff', '#ffff00',
    '#ff0000', '#00ff00', '#0000ff', '#ffffff'
];

// Initialize physics engine
function initPhysics() {
    engine = Engine.create({
        enableSleeping: true,
        constraintIterations: 5
    });
    world = engine.world;
    world.gravity.y = 0.5;

    const mouse = Mouse.create(mainCanvas);
    mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: {
            stiffness: 0.2,
            render: { visible: false }
        }
    });
    World.add(world, mouseConstraint);
    createBoundaries();
}

// Improved boundaries with buffer zone
function createBoundaries() {
    const wallOptions = {
        isStatic: true,
        restitution: 0.8,
        friction: 0.3,
        render: { visible: false }
    };
    
    const thickness = 100;
    const buffer = 50;
    
    World.add(world, [
        Bodies.rectangle(canvasWidth/2, canvasHeight + thickness/2, canvasWidth + thickness*2, thickness, wallOptions), // bottom
        Bodies.rectangle(canvasWidth/2, -thickness/2, canvasWidth + thickness*2, thickness, wallOptions), // top
        Bodies.rectangle(-thickness/2, canvasHeight/2, thickness, canvasHeight + thickness*2, wallOptions), // left
        Bodies.rectangle(canvasWidth + thickness/2, canvasHeight/2, thickness, canvasHeight + thickness*2, wallOptions) // right
    ]);
}

// Reset physics world
function resetPhysics() {
    World.clear(world);
    Engine.clear(engine);
    initPhysics();
    cutPieces = [];
    images = [];
    finishedNeonLines = [];
    permanentDrawings = [];
    selectedBody = null;
    if (grabConstraint) World.remove(world, grabConstraint);
    grabConstraint = null;
}

// Setup canvas
function initCanvas() {
    mainCanvas.width = canvasWidth;
    mainCanvas.height = canvasHeight;
}

// Create image body with physics
function createImageBody(imgSrc, x = canvasWidth/2, y = canvasHeight/2) {
    const img = new Image();
    img.onload = function() {
        const aspectRatio = img.width / img.height;
        let imgWidth = Math.min(canvasWidth * 0.6, img.width);
        let imgHeight = imgWidth / aspectRatio;

        const vertices = [
            { x: -imgWidth/2, y: -imgHeight/2 },
            { x: imgWidth/2, y: -imgHeight/2 },
            { x: imgWidth/2, y: imgHeight/2 },
            { x: -imgWidth/2, y: imgHeight/2 }
        ];

        const body = Bodies.fromVertices(x, y, [vertices], {
            friction: 0.3,
            restitution: 0.6,
            density: 0.001,
            render: { visible: true }
        });

        const textureCanvas = document.createElement('canvas');
        textureCanvas.width = imgWidth;
        textureCanvas.height = imgHeight;
        const textureCtx = textureCanvas.getContext('2d');
        textureCtx.drawImage(img, 0, 0, imgWidth, imgHeight);

        const newPiece = {
            body: body,
            texture: textureCanvas,
            originalWidth: imgWidth,
            originalHeight: imgHeight,
            localVertices: vertices
        };

        cutPieces.push(newPiece);
        World.add(world, body);
    };
    img.src = imgSrc;
}

// Event listeners for image upload
imageUpload.addEventListener('change', (e) => {
    const files = e.target.files;
    for (let file of files) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const randomX = 300 + Math.random() * (canvasWidth - 600);
            const randomY = 200 + Math.random() * (canvasHeight - 400);
            createImageBody(event.target.result, randomX, randomY);
        };
        reader.readAsDataURL(file);
    }
});

// Tool selection with resize tool
function setActiveTool(tool) {
    currentTool = tool;
    [cutToolButton, pickupToolButton, drawToolButton, resizeToolButton].forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (tool === 'cut') {
        cutToolButton.classList.add('active');
        mainCanvas.style.cursor = 'crosshair';
    } else if (tool === 'pickup') {
        pickupToolButton.classList.add('active');
        mainCanvas.style.cursor = 'grab';
    } else if (tool === 'draw') {
        drawToolButton.classList.add('active');
        mainCanvas.style.cursor = 'pointer';
    } else if (tool === 'resize') {
        resizeToolButton.classList.add('active');
        mainCanvas.style.cursor = 'cell';
    }
    
    if (grabConstraint) {
        World.remove(world, grabConstraint);
        grabConstraint = null;
    }
    hideResizeSlider();
}

// Organic cutting implementation
function smoothPath(points, tension = 0.5) {
    if (points.length < 3) return points;
    const smoothed = [points[0]];
    
    for (let i = 1; i < points.length - 1; i++) {
        const p0 = points[i-1];
        const p1 = points[i];
        const p2 = points[i+1];
        
        const avgX = (p0.x + p1.x + p2.x) / 3;
        const avgY = (p0.y + p1.y + p2.y) / 3;
        smoothed.push({ x: avgX, y: avgY });
    }
    
    smoothed.push(points[points.length-1]);
    return smoothed;
}

// Improved cutting mechanics
function cutImageAlongPath(path) {
    if (path.length < 5) return;
    
    const smoothedPath = smoothPath(path);
    const currentPieces = [...cutPieces];
    cutPieces = [];
    
    currentPieces.forEach(piece => {
        if (doesPathIntersectPiece(smoothedPath, piece)) {
            const newPieces = splitPieceWithPath(piece, smoothedPath);
            World.remove(world, piece.body);
            
            if (newPieces && newPieces.length > 0) {
                newPieces.forEach(newPiece => {
                    cutPieces.push(newPiece);
                    World.add(world, newPiece.body);
                    Body.setStatic(newPiece.body, false);
                    
                    // Add organic movement
                    const force = Vector.mult(Vector.normalise({
                        x: (Math.random() - 0.5) * 0.1,
                        y: -Math.random() * 0.1
                    }), 0.005);
                    Body.applyForce(newPiece.body, newPiece.body.position, force);
                });
            }
        } else {
            cutPieces.push(piece);
        }
    });
}

// Resize tool implementation
function showResizeSlider() {
    if (!resizeSlider) {
        resizeSlider = document.createElement('input');
        resizeSlider.type = 'range';
        resizeSlider.min = '50';
        resizeSlider.max = '200';
        resizeSlider.value = '100';
        resizeSlider.className = 'resize-slider';
        
        resizeSlider.addEventListener('input', () => {
            if (selectedBody) {
                const scale = resizeSlider.value / 100;
                resizeBody(selectedBody, scale);
            }
        });
        
        document.body.appendChild(resizeSlider);
    }
    resizeSlider.style.display = 'block';
}

function hideResizeSlider() {
    if (resizeSlider) resizeSlider.style.display = 'none';
}

function resizeBody(body, scale) {
    const originalPiece = cutPieces.find(p => p.body === body);
    if (!originalPiece) return;

    const newVertices = originalPiece.localVertices.map(v => ({
        x: v.x * scale,
        y: v.y * scale
    }));

    const newBody = Bodies.fromVertices(
        body.position.x,
        body.position.y,
        [newVertices],
        {
            friction: 0.3,
            restitution: 0.6,
            density: 0.001 * (1/scale)
        }
    );

    // Create new texture canvas
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = originalPiece.originalWidth * scale;
    textureCanvas.height = originalPiece.originalHeight * scale;
    const textureCtx = textureCanvas.getContext('2d');
    textureCtx.drawImage(originalPiece.texture, 
        0, 0, textureCanvas.width, textureCanvas.height);

    // Replace old body
    const index = cutPieces.findIndex(p => p.body === body);
    World.remove(world, body);
    
    cutPieces[index] = {
        body: newBody,
        texture: textureCanvas,
        originalWidth: originalPiece.originalWidth * scale,
        originalHeight: originalPiece.originalHeight * scale,
        localVertices: newVertices
    };
    
    World.add(world, newBody);
    selectedBody = newBody;
}

// Modified mouse handlers
mainCanvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    
    const mousePos = { x: e.offsetX, y: e.offsetY };
    
    if (currentTool === 'cut') {
        isDrawing = true;
        currentNeonPath = [mousePos];
        lastCutPoint = mousePos;
        cutIntensity = 0;
    } else if (currentTool === 'pickup') {
        const bodies = cutPieces.map(p => p.body);
        const found = Query.point(bodies, mousePos);
        if (found.length > 0) {
            selectedBody = found[0];
            Body.setStatic(selectedBody, false);
            
            grabConstraint = Constraint.create({
                pointA: mousePos,
                bodyB: selectedBody,
                pointB: { x: 0, y: 0 },
                stiffness: 0.7
            });
            World.add(world, grabConstraint);
            mainCanvas.style.cursor = 'grabbing';
        }
    } else if (currentTool === 'draw') {
        isDrawing = true;
        currentNeonPath = [mousePos];
    } else if (currentTool === 'resize') {
        const bodies = cutPieces.map(p => p.body);
        const found = Query.point(bodies, mousePos);
        if (found.length > 0) {
            selectedBody = found[0];
            showResizeSlider();
        }
    }
});

mainCanvas.addEventListener('mousemove', (e) => {
    const mousePos = { x: e.offsetX, y: e.offsetY };
    
    if (isDrawing && currentTool === 'cut') {
        const dist = lastCutPoint ? Vector.magnitude(Vector.sub(mousePos, lastCutPoint)) : 0;
        if (dist > minCutDistance) {
            currentNeonPath.push(mousePos);
            lastCutPoint = mousePos;
            cutIntensity = Math.min(1, cutIntensity + 0.05);
        }
    }
    else if (currentTool === 'pickup' && grabConstraint) {
        // Update constraint position
        grabConstraint.pointA = { x: mousePos.x, y: mousePos.y };
    }
});

mainCanvas.addEventListener('mouseup', (e) => {
    if (isDrawing) {
        isDrawing = false;
        
        if (currentNeonPath.length > 1) {
            if (currentTool === 'cut') {
                finishedNeonLines.push({ 
                    path: [...currentNeonPath], 
                    opacity: 1, 
                    color: drawingColor 
                });
                cutImageAlongPath(currentNeonPath);
            } 
            else if (currentTool === 'draw') {
                permanentDrawings.push({
                    path: [...currentNeonPath],
                    color: drawingColor
                });
            }
            currentNeonPath = [];
        }
    } 
    else if (currentTool === 'pickup') {
        if (grabConstraint) {
            World.remove(world, grabConstraint);
            grabConstraint = null;
            selectedBody = null;
        }
        mainCanvas.style.cursor = 'grab';
    }
});

// Cut image along the drawn path
function cutImageAlongPath(path) {
    if (cutPieces.length === 0 || path.length < 5) return; 
    // Make a temporary copy of cutPieces as we'll modify the array
    const currentPieces = [...cutPieces];
    cutPieces = [];
    
    // Process each piece
    for (let piece of currentPieces) {
        // Check if the path intersects this piece
        if (doesPathIntersectPiece(path, piece)) {
            // Split the piece using the exact cut path
            const newPieces = splitPieceWithPath(piece, path);
            
            // Remove the original piece
            World.remove(world, piece.body);
            
            // Add the new pieces if they exist
            if (newPieces && newPieces.length > 0) {
                newPieces.forEach(newPiece => {
                    cutPieces.push(newPiece);
                    World.add(world, newPiece.body);
                    
                    // Make the pieces dynamic with realistic physics
                    Body.setStatic(newPiece.body, false);
                    
                    // Set physics properties based on size
                    const area = calculatePolygonArea(newPiece.body.vertices);
                    const density = 0.001 + (0.002 * (1 - Math.min(area / 50000, 1)));
                    Body.setDensity(newPiece.body, density);
                    
                    // Add some initial velocity for better visual effect
                    const force = Vector.mult(Vector.normalise({
                        x: Math.random() * 2 - 1,
                        y: Math.random() * 2 - 1
                    }), 0.0005 * area);
                    
                    Body.applyForce(newPiece.body, newPiece.body.position, force);
                });
            }
        } else {
            // Keep the piece as is
            cutPieces.push(piece);
        }
    }
}

// Calculate polygon area
function calculatePolygonArea(vertices) {
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        area += vertices[i].x * vertices[j].y;
        area -= vertices[j].x * vertices[i].y;
    }
    return Math.abs(area) / 2;
}

// Check if a path intersects a piece
function doesPathIntersectPiece(path, piece) {
    const vertices = piece.body.vertices;
    
    // Check if any point is inside the piece
    for (let i = 0; i < path.length; i++) {
        if (pointInPolygon(path[i], vertices)) {
            return true;
        }
    }
    
    // Check for line intersections with the piece boundaries
    for (let i = 0; i < path.length - 1; i++) {
        const lineStart = path[i];
        const lineEnd = path[i + 1];
        
        for (let j = 0; j < vertices.length; j++) {
            const polyLineStart = vertices[j];
            const polyLineEnd = vertices[(j + 1) % vertices.length];
            
            if (linesIntersect(lineStart, lineEnd, polyLineStart, polyLineEnd)) {
                return true;
            }
        }
    }
    
    return false;
}

// Check if a point is inside a polygon
function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Check if two line segments intersect
function linesIntersect(p1, p2, p3, p4) {
    const d1 = direction(p3, p4, p1);
    const d2 = direction(p3, p4, p2);
    const d3 = direction(p1, p2, p3);
    const d4 = direction(p1, p2, p4);
    
    // If lines intersect
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && 
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }
    
    // Special cases
    if (d1 === 0 && onSegment(p3, p4, p1)) return true;
    if (d2 === 0 && onSegment(p3, p4, p2)) return true;
    if (d3 === 0 && onSegment(p1, p2, p3)) return true;
    if (d4 === 0 && onSegment(p1, p2, p4)) return true;
    
    return false;
}

// Helper function for line intersection
function direction(a, b, c) {
    return (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
}

// Check if point c is on line segment ab
function onSegment(a, b, c) {
    return c.x <= Math.max(a.x, b.x) && c.x >= Math.min(a.x, b.x) &&
           c.y <= Math.max(a.y, b.y) && c.y >= Math.min(a.y, b.y);
}

// Split a piece with a curved path
function splitPieceWithPath(piece, path) {
    // Extend the path to ensure it completely cuts through the piece
    const extendedPath = extendPathThroughPiece(path, piece);
    
    // Find entry and exit points of the path through the piece
    const intersections = findPieceIntersections(extendedPath, piece);
    
    if (intersections.length < 2) {
        return [piece]; // Can't cut if we don't have at least entry and exit points
    }
    
    // Create two new polygons based on the curved cut path
    const {hull1, hull2} = splitPolygonWithCurvedPath(piece, extendedPath, intersections);
    
    // Create two new pieces
    const newPieces = [];
    
    if (hull1 && hull1.length >= 3) {
        const piece1 = createPieceFromPolygon(hull1, piece);
        if (piece1) newPieces.push(piece1);
    }
    
    if (hull2 && hull2.length >= 3) {
        const piece2 = createPieceFromPolygon(hull2, piece);
        if (piece2) newPieces.push(piece2);
    }
    
    return newPieces;
}

// Extend a path so it passes completely through a piece
function extendPathThroughPiece(path, piece) {
    // Calculate piece bounding box
    const vertices = piece.body.vertices;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (let vertex of vertices) {
        minX = Math.min(minX, vertex.x);
        minY = Math.min(minY, vertex.y);
        maxX = Math.max(maxX, vertex.x);
        maxY = Math.max(maxY, vertex.y);
    }
    
    // Calculate diagonal length of the bounding box (for extension distance)
    const diagonal = Math.sqrt(Math.pow(maxX - minX, 2) + Math.pow(maxY - minY, 2));
    
    // Extend the path in both directions
    const extended = [...path];
    
    if (path.length >= 2) {
        // Calculate extension vector for the start of the path
        const firstVec = Vector.sub(path[1], path[0]);
        const firstNorm = Vector.normalise(firstVec);
        const firstExtend = Vector.mult(firstNorm, -diagonal);
        const firstPoint = Vector.add(path[0], firstExtend);
        
        // Calculate extension vector for the end of the path
        const lastVec = Vector.sub(path[path.length-1], path[path.length-2]);
        const lastNorm = Vector.normalise(lastVec);
        const lastExtend = Vector.mult(lastNorm, diagonal);
        const lastPoint = Vector.add(path[path.length-1], lastExtend);
        
        // Return extended path
        return [firstPoint, ...extended, lastPoint];
    }
    
    return extended;
}

// Find where the path intersects with the piece's edges
function findPieceIntersections(path, piece) {
    const intersections = [];
    const vertices = piece.body.vertices;
    
    // Check each segment of the path against each edge of the piece
    for (let i = 0; i < path.length - 1; i++) {
        const pathStart = path[i];
        const pathEnd = path[i + 1];
        
        for (let j = 0; j < vertices.length; j++) {
            const edgeStart = vertices[j];
            const edgeEnd = vertices[(j + 1) % vertices.length];
            
            // Find intersection between path segment and piece edge
            const intersection = lineIntersection(
                pathStart.x, pathStart.y, 
                pathEnd.x, pathEnd.y, 
                edgeStart.x, edgeStart.y, 
                edgeEnd.x, edgeEnd.y
            );
            
            if (intersection) {
                // Store intersection point and path index
                intersections.push({
                    point: intersection,
                    pathIndex: i,
                    edgeIndex: j
                });
            }
        }
    }
    
    return intersections;
}

// Calculate the exact intersection point of two line segments
function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    
    // Lines are parallel
    if (denom === 0) {
        return null;
    }
    
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
    
    // Check if intersection point is on both line segments
    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
        return {
            x: x1 + ua * (x2 - x1),
            y: y1 + ua * (y2 - y1)
        };
    }
    
    return null;
}

// Split a polygon with a curved path
function splitPolygonWithCurvedPath(piece, path, intersections) {
    if (intersections.length < 2) {
        return { hull1: null, hull2: null };
    }
    
    // Sort intersections by position along the path
    intersections.sort((a, b) => a.pathIndex - b.pathIndex);
    
    // Extract the curved portion of the path that cuts through the piece
    const entryIntersection = intersections[0];
    const exitIntersection = intersections[intersections.length - 1];
    
    // Extract vertices of the piece
    const vertices = piece.body.vertices.map(v => ({ x: v.x, y: v.y }));
    
    // Extract the relevant portion of the path
    let cutPath = [];
    
    // Add the entry point
    cutPath.push(entryIntersection.point);
    
    // Add all path points between entry and exit
    for (let i = entryIntersection.pathIndex + 1; i <= exitIntersection.pathIndex; i++) {
        cutPath.push(path[i]);
    }
    
    // Add the exit point
    cutPath.push(exitIntersection.point);
    
    // Create two new polygons by going around the piece vertices in both directions
    // From entry to exit along the piece edge, then back along the cut path
    const hull1 = [];
    const hull2 = [];
    
    // Find the entry and exit edge indices
    const entryEdgeIndex = entryIntersection.edgeIndex;
    const exitEdgeIndex = exitIntersection.edgeIndex;
    
    // Build hull1 - go from entry to exit along the piece edges
    hull1.push(entryIntersection.point);
    
    let currentIndex = (entryEdgeIndex + 1) % vertices.length;
    while (currentIndex !== (exitEdgeIndex + 1) % vertices.length) {
        hull1.push(vertices[currentIndex]);
        currentIndex = (currentIndex + 1) % vertices.length;
    }
    
    hull1.push(exitIntersection.point);
    
    // Add the reversed cut path (from exit to entry)
    for (let i = cutPath.length - 2; i >= 1; i--) {
        hull1.push(cutPath[i]);
    }
    
    // Build hull2 - go from exit to entry along the piece edges
    hull2.push(exitIntersection.point);
    
    currentIndex = (exitEdgeIndex + 1) % vertices.length;
    while (currentIndex !== (entryEdgeIndex + 1) % vertices.length) {
        hull2.push(vertices[currentIndex]);
        currentIndex = (currentIndex + 1) % vertices.length;
    }
    
    hull2.push(entryIntersection.point);
    
    // Add the cut path (from entry to exit)
    for (let i = 1; i < cutPath.length - 1; i++) {
        hull2.push(cutPath[i]);
    }
    
    return { hull1, hull2 };
}

// Create a piece from a polygon
function createPieceFromPolygon(polygon, originalPiece) {
    if (polygon.length < 3) return null;
    
    try {
        // Calculate centroid
        let cx = 0, cy = 0;
        for (let vertex of polygon) {
            cx += vertex.x;
            cy += vertex.y;
        }
        cx /= polygon.length;
        cy /= polygon.length;
        
        // Create a new body from the polygon
        const body = Bodies.fromVertices(cx, cy, [polygon], {
            friction: 0.3,
            restitution: 0.6,
            density: 0.001  // We'll adjust this based on size later
        });
        
        if (!body) return null;
        
        // Create a new canvas for the texture
        const textureCanvas = document.createElement('canvas');
        const width = originalPiece.originalWidth;
        const height = originalPiece.originalHeight;
        textureCanvas.width = width;
        textureCanvas.height = height;
        const textureCtx = textureCanvas.getContext('2d');
        
        // Copy the texture from the original piece
        textureCtx.drawImage(originalPiece.texture, 0, 0);
        
        // Convert world vertices to local coordinates relative to the body
        const localVertices = body.vertices.map(vertex => ({
            x: vertex.x - body.position.x,
            y: vertex.y - body.position.y
        }));
        
        return {
            body: body,
            texture: textureCanvas,
            originalWidth: width,
            originalHeight: height,
            localVertices: localVertices
        };
    } catch (error) {
        console.error("Error creating piece:", error);
        return null;
    }
}

// Draw a piece with its texture
function drawPiece(piece) {
    const body = piece.body;
    const pos = body.position;
    const angle = body.angle;
    
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);

    // Draw the texture
    const vertices = body.vertices;
    
    // Clip to the shape of the piece
    ctx.beginPath();
    ctx.moveTo(vertices[0].x - pos.x, vertices[0].y - pos.y);
    for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i].x - pos.x, vertices[i].y - pos.y);
    }
    ctx.closePath();
    ctx.clip();
    
    // Draw the image
    ctx.drawImage(
        piece.texture, 
        -piece.originalWidth / 2, 
        -piece.originalHeight / 2,
        piece.originalWidth,
        piece.originalHeight
    );
    
    ctx.restore();
}

// Create color wheel for drawing
function createColorWheel() {
    const colorWheel = document.createElement('div');
    colorWheel.id = 'colorWheel';
    colorWheel.className = 'color-wheel';
    document.querySelector('.tool-container').appendChild(colorWheel);
    
    colorOptions.forEach(color => {
        const colorOption = document.createElement('div');
        colorOption.className = 'color-option';
        colorOption.style.backgroundColor = color;
        colorOption.addEventListener('click', () => {
            drawingColor = color;
            document.querySelectorAll('.color-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            colorOption.classList.add('selected');
        });
        colorWheel.appendChild(colorOption);
    });
    
    // Select first color by default
    colorWheel.querySelector('.color-option').classList.add('selected');
}

// Draw neon effect
function drawNeonEffect(x, y, color = drawingColor, intensity = 1) {
    ctx.shadowBlur = neonShadowBlur * intensity;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = neonLineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Draw the glow multiple times for stronger effect
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.stroke();
    }
}

// Render loop
function render() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // Draw background
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Apply physics engine update with fixed time step
    Engine.update(engine, 16.667);
    
    // Draw all pieces
    cutPieces.forEach(piece => {
        if (piece && piece.body) {
            // Keep objects within canvas boundaries with realistic bounce
            if (piece.body.position.x < 0) {
                Body.setPosition(piece.body, { 
                    x: 10, 
                    y: piece.body.position.y 
                });
                Body.setVelocity(piece.body, { 
                    x: Math.abs(piece.body.velocity.x) * 0.5, 
                    y: piece.body.velocity.y 
                });
            }
            if (piece.body.position.x > canvasWidth) {
                Body.setPosition(piece.body, { 
                    x: canvasWidth - 10, 
                    y: piece.body.position.y 
                });
                Body.setVelocity(piece.body, { 
                    x: -Math.abs(piece.body.velocity.x) * 0.5, 
                    y: piece.body.velocity.y 
                });
            }
            if (piece.body.position.y < 0) {
                Body.setPosition(piece.body, { 
                    x: piece.body.position.x, 
                    y: 10 
                });
                Body.setVelocity(piece.body, { 
                    x: piece.body.velocity.x, 
                    y: Math.abs(piece.body.velocity.y) * 0.5 
                });
            }
            if (piece.body.position.y > canvasHeight) {
                Body.setPosition(piece.body, { 
                    x: piece.body.position.x, 
                    y: canvasHeight - 10 
                });
                Body.setVelocity(piece.body, { 
                    x: piece.body.velocity.x, 
                    y: -Math.abs(piece.body.velocity.y) * 0.5 
                });
            }
            
            drawPiece(piece);
        }
    });
    
    // Draw current neon path
    if (currentNeonPath.length > 1) {
        ctx.shadowBlur = neonShadowBlur;
        ctx.shadowColor = drawingColor;
        ctx.strokeStyle = drawingColor;
        ctx.lineWidth = neonLineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(currentNeonPath[0].x, currentNeonPath[0].y);
        
        for (let i = 1; i < currentNeonPath.length; i++) {
            ctx.lineTo(currentNeonPath[i].x, currentNeonPath[i].y);
        }
        
        ctx.stroke();
    }
    
    // Draw finished neon lines with fade effect
    finishedNeonLines.forEach((line, index) => {
        if (line.opacity <= 0) {
            finishedNeonLines.splice(index, 1);
            return;
        }
        
        ctx.shadowBlur = neonShadowBlur * line.opacity;
        ctx.shadowColor = line.color;
        ctx.strokeStyle = line.color;
        ctx.lineWidth = neonLineWidth * line.opacity;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(line.path[0].x, line.path[0].y);
        
        for (let i = 1; i < line.path.length; i++) {
            ctx.lineTo(line.path[i].x, line.path[i].y);
        }
        
        ctx.stroke();
        
        // Fade out cut lines
        line.opacity -= 0.01;
    });
    
    // Draw permanent drawings (from draw tool)
    permanentDrawings.forEach(drawing => {
        ctx.shadowBlur = neonShadowBlur;
        ctx.shadowColor = drawing.color;
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = neonLineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(drawing.path[0].x, drawing.path[0].y);
        
        for (let i = 1; i < drawing.path.length; i++) {
            ctx.lineTo(drawing.path[i].x, drawing.path[i].y);
        }
        
        ctx.stroke();
    });
    
    // Draw resize UI if active
    if (selectedBody && currentTool === 'resize') {
        const pos = selectedBody.position;
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        
        // Draw bounding box
        const bounds = selectedBody.bounds;
        ctx.beginPath();
        ctx.rect(
            bounds.min.x, 
            bounds.min.y, 
            bounds.max.x - bounds.min.x, 
            bounds.max.y - bounds.min.y
        );
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    requestAnimationFrame(render);
}

// Initialize everything
function init() {
    initCanvas();
    initPhysics();
    createColorWheel();
    
    // Set initial tool
    cutToolButton.classList.add('active');
    
    // Tool button events
    cutToolButton.addEventListener('click', () => setActiveTool('cut'));
    pickupToolButton.addEventListener('click', () => setActiveTool('pickup'));
    drawToolButton.addEventListener('click', () => setActiveTool('draw'));
    resizeToolButton.addEventListener('click', () => setActiveTool('resize'));
    
    // Other button events
    uploadNewButton.addEventListener('click', () => imageUpload.click());
    resetButton.addEventListener('click', () => {
        resetPhysics();
        finishedNeonLines = [];
        permanentDrawings = [];
    });
    
    // Start render loop
    requestAnimationFrame(render);
}

// Start the application
init();

// Add CSS for the color wheel and resize slider
const style = document.createElement('style');
style.textContent = `
.color-wheel {
    display: flex;
    justify-content: center;
    margin-top: 10px;
}
.color-option {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    margin: 0 5px;
    cursor: pointer;
    border: 2px solid #333;
    transition: transform 0.2s;
}
.color-option:hover {
    transform: scale(1.2);
}
.color-option.selected {
    border: 2px solid white;
    transform: scale(1.2);
}
.resize-slider {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: 200px;
    background: rgba(0, 0, 0, 0.7);
    padding: 10px;
    border-radius: 5px;
    z-index: 1000;
}
`;
document.head.appendChild(style);