// Get DOM elements
const imageUpload = document.getElementById('imageUpload');
const mainCanvas = document.getElementById('mainCanvas');
const ctx = mainCanvas.getContext('2d');
const uploadNewButton = document.getElementById('uploadNew');
const resetButton = document.getElementById('resetCanvas');
const cutToolButton = document.getElementById('cutTool');
const pickupToolButton = document.getElementById('pickupTool');
const drawToolButton = document.getElementById('drawTool');

// Access Matter.js modules
const { Engine, Render, World, Bodies, Body, Vertices, Vector, Composite, MouseConstraint, Mouse, Query, Constraint } = Matter;

// Canvas dimensions
const canvasWidth = 1000;
const canvasHeight = 700;

// Variables
let img = new Image();
let engine;
let world;
let mouseConstraint;
let cutPieces = [];
let isDrawing = false;
let currentTool = 'cut'; // Default tool
let currentNeonPath = [];
let finishedNeonLines = [];
let drawingColor = '#00ffff'; // Default drawing color
let permanentDrawings = [];
let imageLoaded = false;
let selectedBody = null;
let grabConstraint = null;

// Color and style settings
const neonLineWidth = 5;
const neonShadowBlur = 15;

// Available drawing colors
const colorOptions = [
    '#00ffff', // Cyan
    '#ff00ff', // Magenta
    '#ffff00', // Yellow
    '#ff0000', // Red
    '#00ff00', // Green
    '#0000ff', // Blue
    '#ffffff'  // White
];

// Initialize the physics engine
function initPhysics() {
    engine = Engine.create({
        enableSleeping: true,
        constraintIterations: 5
    });
    world = engine.world;
    world.gravity.y = 0.5;

    // Create mouse for interaction
    const mouse = Mouse.create(mainCanvas);
    mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: {
            stiffness: 0.2,
            render: { visible: false }
        }
    });
    World.add(world, mouseConstraint);

    // Create canvas boundaries to keep pieces inside
    createBoundaries();
}

// Create boundaries to keep pieces inside the canvas
function createBoundaries() {
    const wallOptions = {
        isStatic: true,
        restitution: 0.6,
        friction: 0.1,
        render: { visible: false }
    };
    
    // Create boundaries slightly beyond canvas edges
    const thickness = 50;
    
    // Bottom boundary
    const bottom = Bodies.rectangle(
        canvasWidth / 2, 
        canvasHeight + thickness / 2, 
        canvasWidth + thickness * 2, 
        thickness, 
        wallOptions
    );
    
    // Top boundary
    const top = Bodies.rectangle(
        canvasWidth / 2, 
        -thickness / 2, 
        canvasWidth + thickness * 2, 
        thickness, 
        wallOptions
    );
    
    // Left boundary
    const left = Bodies.rectangle(
        -thickness / 2, 
        canvasHeight / 2, 
        thickness, 
        canvasHeight + thickness * 2, 
        wallOptions
    );
    
    // Right boundary
    const right = Bodies.rectangle(
        canvasWidth + thickness / 2, 
        canvasHeight / 2, 
        thickness, 
        canvasHeight + thickness * 2, 
        wallOptions
    );
    
    World.add(world, [bottom, top, left, right]);
}

// Reset the physics world
function resetPhysics() {
    World.clear(world);
    Engine.clear(engine);
    initPhysics();
    cutPieces = [];
    finishedNeonLines = [];
    permanentDrawings = [];
    selectedBody = null;
    if (grabConstraint) {
        World.remove(world, grabConstraint);
        grabConstraint = null;
    }
    if (imageLoaded) {
        createImageBody();
    }
}

// Setup canvas
function initCanvas() {
    mainCanvas.width = canvasWidth;
    mainCanvas.height = canvasHeight;
}

// Create the initial image body
function createImageBody() {
    // Calculate dimensions maintaining aspect ratio
    const aspectRatio = img.width / img.height;
    let imgWidth, imgHeight;
    
    if (aspectRatio > 1) {
        // Landscape
        imgWidth = Math.min(canvasWidth * 0.8, img.width);
        imgHeight = imgWidth / aspectRatio;
    } else {
        // Portrait
        imgHeight = Math.min(canvasHeight * 0.8, img.height);
        imgWidth = imgHeight * aspectRatio;
    }

    // Create a rectangle for the image
    const x = canvasWidth / 2;
    const y = canvasHeight / 2;
    
    // Create image body vertices
    const vertices = [
        { x: -imgWidth/2, y: -imgHeight/2 },
        { x: imgWidth/2, y: -imgHeight/2 },
        { x: imgWidth/2, y: imgHeight/2 },
        { x: -imgWidth/2, y: imgHeight/2 }
    ];
    
    // Create the body
    const body = Bodies.fromVertices(x, y, [vertices], {
        isStatic: true,
        friction: 0.1,
        restitution: 0.6,
        density: 0.001, // Lower density to make pieces lighter
        render: { visible: true }
    });
    
    World.add(world, body);
    
    // Create offscreen canvas for texture
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = imgWidth;
    textureCanvas.height = imgHeight;
    const textureCtx = textureCanvas.getContext('2d');
    textureCtx.drawImage(img, 0, 0, imgWidth, imgHeight);
    
    // Add the piece to our tracking array
    cutPieces.push({
        body: body,
        texture: textureCanvas,
        originalWidth: imgWidth,
        originalHeight: imgHeight,
        // Store local vertices for drawing
        localVertices: vertices
    });
}

// Event listeners for image upload
imageUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            img = new Image();
            img.onload = () => {
                imageLoaded = true;
                resetPhysics();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

uploadNewButton.addEventListener('click', () => {
    imageUpload.click();
});

resetButton.addEventListener('click', resetPhysics);

// Tool selection
cutToolButton.addEventListener('click', () => setActiveTool('cut'));
pickupToolButton.addEventListener('click', () => setActiveTool('pickup'));
drawToolButton.addEventListener('click', () => setActiveTool('draw'));

function setActiveTool(tool) {
    currentTool = tool;
    
    // Update button styling
    [cutToolButton, pickupToolButton, drawToolButton].forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Set the active button
    if (tool === 'cut') {
        cutToolButton.classList.add('active');
        mainCanvas.style.cursor = 'crosshair';
    } else if (tool === 'pickup') {
        pickupToolButton.classList.add('active');
        mainCanvas.style.cursor = 'grab';
    } else if (tool === 'draw') {
        drawToolButton.classList.add('active');
        mainCanvas.style.cursor = 'pointer';
    }
    
    // Release any constraints when switching tools
    if (grabConstraint) {
        World.remove(world, grabConstraint);
        grabConstraint = null;
    }
}

// Draw a neon line effect
function drawNeonLine(path, color = '#00ffff', opacity = 1) {
    if (path.length < 2) return;

    ctx.save();
    ctx.lineWidth = neonLineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = neonShadowBlur;
    ctx.shadowColor = color.replace(')', `, ${opacity})`).replace('rgb', 'rgba');
    ctx.strokeStyle = color.replace(')', `, ${opacity})`).replace('rgb', 'rgba');
    
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    
    for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
    }
    
    ctx.stroke();
    ctx.restore();
}
// Mouse event handlers
mainCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Left mouse button
        const mouseX = e.offsetX;
        const mouseY = e.offsetY;
        
        if (currentTool === 'cut') {
            // Only start drawing the cut line, no other behavior
            isDrawing = true;
            currentNeonPath = [{ x: mouseX, y: mouseY }];
        } 
        else if (currentTool === 'pickup') {
            // Find body under cursor
            const bodies = cutPieces.map(piece => piece.body);
            const bodiesAtPoint = Query.point(bodies, { x: mouseX, y: mouseY });
            
            if (bodiesAtPoint.length > 0) {
                selectedBody = bodiesAtPoint[0];
                Body.setStatic(selectedBody, false);
                
                // Create constraint to drag the body
                grabConstraint = Constraint.create({
                    pointA: { x: mouseX, y: mouseY },
                    bodyB: selectedBody,
                    pointB: { x: 0, y: 0 },
                    stiffness: 0.7,
                    length: 0
                });
                World.add(world, grabConstraint);
                
                mainCanvas.style.cursor = 'grabbing';
            }
        } 
        else if (currentTool === 'draw') {
            isDrawing = true;
            currentNeonPath = [{ x: mouseX, y: mouseY }];
        }
    }
});

mainCanvas.addEventListener('mousemove', (e) => {
    const mouseX = e.offsetX;
    const mouseY = e.offsetY;
    
    if (isDrawing) {
        currentNeonPath.push({ x: mouseX, y: mouseY });
    } 
    else if (currentTool === 'pickup' && grabConstraint) {
        // Update constraint position
        grabConstraint.pointA = { x: mouseX, y: mouseY };
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
    if (!imageLoaded || cutPieces.length === 0 || path.length < 5) return;
    
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
    
    // Create two new pieces based on the curved cut path
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
    
    // Create a clipping path from the body vertices
    ctx.beginPath();
    const vertices = body.vertices;
    if (vertices.length > 0) {
        const firstVertex = vertices[0];
        ctx.moveTo(firstVertex.x - pos.x, firstVertex.y - pos.y);
        
        for (let i = 1; i < vertices.length; i++) {
            const vertex = vertices[i];
            ctx.lineTo(vertex.x - pos.x, vertex.y - pos.y);
        }
        
        ctx.closePath();
        ctx.clip();
        
        // Draw the texture
        const offsetX = piece.originalWidth / 2;
        const offsetY = piece.originalHeight / 2;
        ctx.drawImage(
            piece.texture, 
            -offsetX, 
            -offsetY, 
            piece.originalWidth, 
            piece.originalHeight
        );
    }
    
    // Draw a subtle border
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    ctx.restore();
}

// Create color picker UI
function createColorPicker() {
    const sidebar = document.querySelector('.sidebar');
    
    // Create color picker container
    const colorPicker = document.createElement('div');
    colorPicker.className = 'color-picker';
    colorPicker.innerHTML = '<h3>Color Picker</h3>';
    
    // Create color swatches
    const swatchContainer = document.createElement('div');
    swatchContainer.className = 'color-swatches';
    
    // Add color options
    colorOptions.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        
        // Mark active color
        if (color === drawingColor) {
            swatch.classList.add('active');
        }
        
        // Add click handler
        swatch.addEventListener('click', () => {
            // Update active swatch
            document.querySelectorAll('.color-swatch').forEach(s => {
                s.classList.remove('active');
            });
            swatch.classList.add('active');
            
            // Set the drawing color
            drawingColor = color;
        });
        
        swatchContainer.appendChild(swatch);
    });
    
    // Add eraser option
    const eraser = document.createElement('div');
    eraser.className = 'color-swatch eraser';
    eraser.innerHTML = '❌'; // Eraser icon
    eraser.addEventListener('click', () => {
        permanentDrawings = []; // Clear drawings
    });
    
    swatchContainer.appendChild(eraser);
    colorPicker.appendChild(swatchContainer);
    
    // Add to sidebar
    sidebar.appendChild(colorPicker);
    
    // Add CSS for color picker
    const style = document.createElement('style');
    style.innerHTML = `
        .color-picker {
            margin-top: 20px;
            border-top: 1px solid rgba(0, 255, 255, 0.3);
            padding-top: 10px;
        }
        
       .color-picker h3 {
            font-size: 16px;
            margin-bottom: 10px;
            color: #00ffff;
        }
        
        .color-swatches {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }
        
        .color-swatch {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            cursor: pointer;
            border: 2px solid transparent;
            transition: transform 0.2s, border-color 0.2s;
        }
        
        .color-swatch:hover {
            transform: scale(1.1);
        }
        
        .color-swatch.active {
            border-color: white;
            box-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
        }
        
        .eraser {
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #333;
            color: white;
            font-size: 16px;
        }
    `;
    document.head.appendChild(style);
}

// Game loop
function update() {
    // Clear the canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // Update physics
    Engine.update(engine, 1000 / 60);
    
    // Draw background
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Draw pieces
    for (let piece of cutPieces) {
        drawPiece(piece);
        
        // Keep pieces within canvas bounds
        const pos = piece.body.position;
        const bounds = piece.body.bounds;
        
        // Check if piece is going out of bounds and adjust
        if (bounds.min.x < 0 || bounds.max.x > canvasWidth || 
            bounds.min.y < 0 || bounds.max.y > canvasHeight) {
            
            // Apply gentle force to push back into canvas
            const center = { x: canvasWidth / 2, y: canvasHeight / 2 };
            const direction = Vector.normalise(Vector.sub(center, pos));
            const distance = Vector.magnitude(Vector.sub(center, pos));
            const strength = 0.001 * Math.min(1, (distance / 300));
            
            Body.applyForce(piece.body, pos, Vector.mult(direction, strength));
            
            // Apply damping to slow pieces that try to leave
            Body.setVelocity(piece.body, Vector.mult(piece.body.velocity, 0.95));
            Body.setAngularVelocity(piece.body, piece.body.angularVelocity * 0.95);
        }
    }
    
    // Draw permanent neon drawings
    for (let drawing of permanentDrawings) {
        drawNeonLine(drawing.path, drawing.color);
    }
    
    // Draw temporary cut/draw path
    if (isDrawing && currentNeonPath.length > 1) {
        drawNeonLine(currentNeonPath, drawingColor);
    }
    
    // Draw finished cut lines with fading effect
    for (let i = 0; i < finishedNeonLines.length; i++) {
        const line = finishedNeonLines[i];
        drawNeonLine(line.path, line.color, line.opacity);
        
        // Fade out completed cut lines
        line.opacity -= 0.01;
        if (line.opacity <= 0) {
            finishedNeonLines.splice(i, 1);
            i--;
        }
    }
    
    // Draw constraint if active
    if (grabConstraint && grabConstraint.bodyB) {
        ctx.beginPath();
        ctx.moveTo(grabConstraint.pointA.x, grabConstraint.pointA.y);
        ctx.lineTo(grabConstraint.bodyB.position.x, grabConstraint.bodyB.position.y);
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    // Request next frame
    requestAnimationFrame(update);
}

// Generate UI elements for dragging and toggling gravity
function createPhysicsControls() {
    const sidebar = document.querySelector('.sidebar');
    
    // Create controls container
    const controls = document.createElement('div');
    controls.className = 'physics-controls';
    controls.innerHTML = '<h3>Physics Controls</h3>';
    
    // Gravity slider
    const gravityControl = document.createElement('div');
    gravityControl.className = 'control-group';
    
    const gravityLabel = document.createElement('label');
    gravityLabel.textContent = 'Gravity';
    
    const gravitySlider = document.createElement('input');
    gravitySlider.type = 'range';
    gravitySlider.min = '0';
    gravitySlider.max = '1';
    gravitySlider.step = '0.1';
    gravitySlider.value = '0.5'; // Default gravity
    
    gravitySlider.addEventListener('input', () => {
        world.gravity.y = parseFloat(gravitySlider.value);
    });
    
    gravityControl.appendChild(gravityLabel);
    gravityControl.appendChild(gravitySlider);
    
    // Bounce slider
    const bounceControl = document.createElement('div');
    bounceControl.className = 'control-group';
    
    const bounceLabel = document.createElement('label');
    bounceLabel.textContent = 'Bounciness';
    
    const bounceSlider = document.createElement('input');
    bounceSlider.type = 'range';
    bounceSlider.min = '0';
    bounceSlider.max = '1';
    bounceSlider.step = '0.1';
    bounceSlider.value = '0.6'; // Default restitution
    
    bounceSlider.addEventListener('input', () => {
        const restitution = parseFloat(bounceSlider.value);
        for (let piece of cutPieces) {
            piece.body.restitution = restitution;
        }
    });
    
    bounceControl.appendChild(bounceLabel);
    bounceControl.appendChild(bounceSlider);
    
    controls.appendChild(gravityControl);
    controls.appendChild(bounceControl);
    
    // Add to sidebar
    sidebar.appendChild(controls);
    
    // Add CSS for controls
    const style = document.createElement('style');
    style.innerHTML = `
        .physics-controls {
            margin-top: 20px;
            border-top: 1px solid rgba(0, 255, 255, 0.3);
            padding-top: 10px;
        }
        
        .physics-controls h3 {
            font-size: 16px;
            margin-bottom: 10px;
            color: #00ffff;
        }
        
        .control-group {
            margin-bottom: 10px;
        }
        
        .control-group label {
            display: block;
            margin-bottom: 5px;
            color: #ccc;
        }
        
        .control-group input[type="range"] {
            width: 100%;
            -webkit-appearance: none;
            height: 8px;
            border-radius: 4px;
            background: #333;
            outline: none;
        }
        
        .control-group input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #00ffff;
            cursor: pointer;
            box-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
        }
    `;
    document.head.appendChild(style);
}

// Improved function to initialize the application
function init() {
    initCanvas();
    initPhysics();
    createColorPicker();
    createPhysicsControls();
    setActiveTool('cut'); // Default tool
    requestAnimationFrame(update);
}

// Initialize the application when the DOM is ready
document.addEventListener('DOMContentLoaded', init);