function WaveModule(stdlib, foreign, heapBuffer) {

    var w = foreign.width, h = foreign.height, wh = w * h;

    var velocityDampingBitShift = 7, forceDampingBitShift = 2, gammaBitShift = 12;

    var ioImage_offset = 0;
    var masterImage_offset = wh;
    var u0_offset = 2 * wh;
    var u1_offset = 3 * wh;
    var vel_offset = 4 * wh;
    var force_offset = 5 * wh;

    var unsignedHeap = new stdlib.Uint32Array(heapBuffer);
    var signedHeap = new stdlib.Int32Array(heapBuffer);

    function applyCap(x) {
        return x < -0x60000000 ? -0x60000000 : (x > 0x60000000 ? 0x60000000 : x);
    }

    /*
     * Applies the wave equation d2u/dt2 = c*c*(d2u/dx2+d2u/dy2)
     * where all derivatives on the right are partial 2nd derivatives
     */
    function iterate() {

        var index = 0, i = 0, j = 0;

        var uCen = 0, uNorth = 0, uSouth = 0, uEast = 0, uWest = 0;

        var totalCycles = 4;
        for (var cycle = 0; cycle < totalCycles; cycle++) {
            index = 0;
            for (i = 0; i < h; i++) {
                for (j = 0; j < w; j++) {
                    if (i == 0) {
                        index++;
                        continue;
                    }
                    if (i + 1 == h) {
                        index++;
                        continue;
                    }
                    if (j == 0) {
                        index++;
                        continue;
                    }
                    if (j + 1 == w) {
                        index++;
                        continue;
                    }
                    uCen = signedHeap   [u0_offset + index];
                    uNorth = signedHeap[u0_offset + index - w];
                    uSouth = signedHeap[u0_offset + index + w];
                    uWest = signedHeap[u0_offset + index - 1];
                    uEast = signedHeap[u0_offset + index + 1];

                    var uxx = (((uWest + uEast) >> 1) - uCen);
                    var uyy = (((uNorth + uSouth) >> 1) - uCen);

                    var vel = signedHeap[vel_offset + index];
                    vel = vel + (uxx >> 1);
                    vel = applyCap(vel);
                    vel = vel + (uyy >> 1);
                    vel = applyCap(vel);

                    var force = signedHeap[force_offset + index];
                    signedHeap[u1_offset + index] = applyCap(force + applyCap(uCen + vel));
                    force -=(force >> forceDampingBitShift);
                    signedHeap[force_offset + index] = force;
                    vel -= (vel >> velocityDampingBitShift);
                    signedHeap[vel_offset + index] = vel;

                    index++;
                }
            }

            var swap = u0_offset;
            u0_offset = u1_offset;
            u1_offset = swap;
        }

        // Now draw a refracted copy of the original image into the start of the heap...
        index = 0;

        var refractedX = 0, refractedY = 0;

        for (i = 0; i < h; i++) {
            for (j = 0; j < w; j++) {

                var masterIndex = (masterImage_offset + index);

                if (i > 0 && i < h - 1 && j > 0 && j < w - 1) {
                    uNorth = signedHeap[u0_offset + index - w];
                    uSouth = signedHeap[u0_offset + index + w];
                    uWest = signedHeap[u0_offset + index - 1];
                    uEast = signedHeap[u0_offset + index + 1];

                    var ux = (uEast - uWest);
                    var uy = (uSouth - uNorth);

                    refractedX = (j + (ux >> gammaBitShift));
                    refractedY = (i + (uy >> gammaBitShift));
                    if (refractedX < 0) {
                        masterIndex = index++;
                        continue;
                    }
                    if (refractedX >= w) {
                        masterIndex = index++;
                        continue;
                    }
                    if (refractedY < 0) {
                        masterIndex = index++;
                        continue;
                    }
                    if (refractedY >= h) {
                        masterIndex = index++;
                        continue;
                    }
                    // general case
                    masterIndex = masterImage_offset + (refractedY * w) + refractedX;
                }
                unsignedHeap[ioImage_offset + index] = unsignedHeap[masterIndex];
                index++;
            }
        }
    }

    return {
        iterate: iterate
    };
}


function ripple(canvasElement, href) {

    var context = canvasElement.getContext('2d');

    var image = new Image();
    var imageHeight = 0, imageWidth = 0;

    var heap;


    var forceArray;

    var module = null;
    function createWaveModule(imageDataArray, imageWidth, imageHeight) {
        var heapSize = 0x400000 * Math.ceil(24 * imageWidth * imageHeight / 0x400000);
        heap = new ArrayBuffer(heapSize);

        // Leave the master copy of the image into its home in the buffer
        var imageBytes = new Uint8Array(imageDataArray.buffer);
        var heapBytes = new Uint8Array(heap);
        for (var i = 0; i < 4 * imageWidth * imageHeight; i++) {
            heapBytes[4 * imageWidth * imageHeight + i] = imageBytes[i];
        }

        forceArray = new Int32Array(heap, 20 * imageWidth * imageHeight, imageWidth * imageHeight); // mouse needs to access this heap region

        var size = {
            width: imageWidth,
            height: imageHeight
        };

        return new WaveModule(window, size, heap);
    };

    function animate() {
        var pre = $.now();
        module.iterate();
        var diff = $.now() - pre;
        $("#benchmark").text("Time: "+diff+" ms");
        var arr = new Uint8ClampedArray(heap, 0, 4 * imageHeight * imageWidth);
        var imgData = context.createImageData(imageWidth, imageHeight);
        imgData.data.set(arr);
        context.putImageData(imgData, 0, 0);
        setTimeout(animate, 10);
    }

    function windowToCanvas(canvas, x, y) {
        var bbox = canvas.getBoundingClientRect();
        return {
            x: Math.round(x - bbox.left * (canvas.width / bbox.width)),
            y: Math.round(y - bbox.top * (canvas.height / bbox.height))
        };
    }

    image.onload = function () {
        imageWidth = image.width;
        imageHeight = image.height;
        canvasElement.width = imageWidth;
        canvasElement.height = imageHeight;
        context.drawImage(image, 0, 0);
        var imageData;
        try {
            imageData = context.getImageData(0, 0, imageWidth, imageHeight);
        }
        catch (e) {
            window.alert("Aw, snap! Background lorempixel.com image violated Cross-Origin policy.");
            return;
        }
        context.clearRect(0, 0, imageWidth, imageHeight);
        module = createWaveModule(imageData.data, imageWidth, imageHeight);
        setTimeout(animate, 10);
    };
    image.crossOrigin = "Anonymous";
    image.src = href;


    var brushMatrix = [];
    var brushMatrixRadius = 11;
    for (var p = -brushMatrixRadius; p <= brushMatrixRadius; p++) {
        var row = [];
        brushMatrix.push(row);
        for (var q = -brushMatrixRadius; q <= brushMatrixRadius; q++) {
            var element = Math.floor(0x200000 * Math.exp(-0.2 * ((p * p) + (q * q))));
            row.push(element);
        }
    }

    function applyBrush(x, y) {
        for (p = -brushMatrixRadius; p <= brushMatrixRadius; p++) {
            var targetY = y + p;
            if (targetY < 0 || targetY >= imageHeight) {
                continue;
            }
            for (q = -brushMatrixRadius; q <= brushMatrixRadius; q++) {
                var targetX = x + q;
                if (targetX < 0 || targetX >= imageWidth) {
                    continue;
                }
                forceArray[targetY * imageWidth + targetX] = Math.max(forceArray[targetY * imageWidth + targetX], brushMatrix[p + brushMatrixRadius][q + brushMatrixRadius]);
            }
        }
    }

    var lastX = null, lastY = null;

    canvasElement.onmousedown = function (e) {
        var loc = windowToCanvas(canvasElement, e.clientX, e.clientY);
        lastX = loc.x;
        lastY = loc.y;
        applyBrush(loc.x, loc.y);
    };

    canvasElement.onmousemove = function (e) {
        var loc = windowToCanvas(canvasElement, e.clientX, e.clientY);
        var targetX = loc.x, targetY = loc.y;
        if (lastX !== null && lastY !== null) {
            // draw a line from the last place we were to the current place
            var r = Math.sqrt((loc.x - lastX) * (loc.x - lastX) + (loc.y - lastY) * (loc.y - lastY));
            for (var t = 0; t < r; t++) {
                var currX = Math.round(lastX + (targetX - lastX) * (t / r));
                var currY = Math.round(lastY + (targetY - lastY) * (t / r));
                applyBrush(currX, currY);
            }
            applyBrush(loc.x, loc.y);
            lastX = loc.x;
            lastY = loc.y;
        }
    };

    canvasElement.onmouseover = canvasElement.onmouseout = canvasElement.onmouseup = function (e) {
        lastX = null;
        lastY = null;
    }
};

(function($) {
    $.fn.ripple = function() {
        var img = this;
        var width = img.width();
        var height = img.height();
        this.filter('img').each(function(e) {
            var canvas = $("<canvas/>");
            img.replaceWith(function() {
                canvas.attr("width", width);
                canvas.attr("height", height);
                return canvas;
            });
            ripple(canvas[0], img.attr("src"));
        });
    };
}(jQuery));