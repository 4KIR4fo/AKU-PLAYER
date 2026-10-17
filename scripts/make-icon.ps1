param(
  [string]$Source,
  [string]$Out,
  [int]$Size = 512,
  [int]$Threshold = 235
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore

if (-not $Source) {
  $Source = Join-Path (Split-Path $PSScriptRoot -Parent) 'build\icon-source.webp'
}
if (-not $Out) {
  $Out = Join-Path (Split-Path $PSScriptRoot -Parent) 'build\icon.png'
}

$uri = New-Object System.Uri $Source
$decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($uri, 'None', 'OnLoad')
$frame = $decoder.Frames[0]

$side = [Math]::Min($frame.PixelWidth, $frame.PixelHeight)
$cropX = [int](($frame.PixelWidth - $side) / 2)
$cropY = [int](($frame.PixelHeight - $side) / 2)
$rect = [System.Windows.Int32Rect]::new($cropX, $cropY, $side, $side)
$cropped = New-Object System.Windows.Media.Imaging.CroppedBitmap -ArgumentList $frame, $rect

$scale = New-Object System.Windows.Media.ScaleTransform -ArgumentList ($Size / $side), ($Size / $side)
$scaled = New-Object System.Windows.Media.Imaging.TransformedBitmap -ArgumentList $cropped, $scale

$converted = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap -ArgumentList $scaled, ([System.Windows.Media.PixelFormats]::Bgra32), $null, 0

$width = $converted.PixelWidth
$height = $converted.PixelHeight
$stride = $width * 4
$pixels = New-Object byte[] ($stride * $height)
$converted.CopyPixels($pixels, $stride, 0)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;

public static class IconKeyer
{
    public static int KeyWhite(byte[] px, int w, int h, byte threshold)
    {
        bool[] visited = new bool[w * h];
        Queue<int> queue = new Queue<int>();

        for (int x = 0; x < w; x++)
        {
            EnqueueIfWhite(queue, visited, px, w, x, 0, threshold);
            EnqueueIfWhite(queue, visited, px, w, x, h - 1, threshold);
        }
        for (int y = 0; y < h; y++)
        {
            EnqueueIfWhite(queue, visited, px, w, 0, y, threshold);
            EnqueueIfWhite(queue, visited, px, w, w - 1, y, threshold);
        }

        int cleared = 0;
        while (queue.Count > 0)
        {
            int idx = queue.Dequeue();
            px[idx * 4 + 3] = 0;
            cleared++;
            int x = idx % w;
            int y = idx / w;
            if (x > 0) EnqueueIfWhite(queue, visited, px, w, x - 1, y, threshold);
            if (x < w - 1) EnqueueIfWhite(queue, visited, px, w, x + 1, y, threshold);
            if (y > 0) EnqueueIfWhite(queue, visited, px, w, x, y - 1, threshold);
            if (y < h - 1) EnqueueIfWhite(queue, visited, px, w, x, y + 1, threshold);
        }
        return cleared;
    }

    private static void EnqueueIfWhite(Queue<int> queue, bool[] visited, byte[] px, int w, int x, int y, byte threshold)
    {
        int idx = y * w + x;
        if (visited[idx]) return;
        visited[idx] = true;
        int p = idx * 4;
        if (px[p] >= threshold && px[p + 1] >= threshold && px[p + 2] >= threshold)
        {
            queue.Enqueue(idx);
        }
    }
}
"@

$cleared = [IconKeyer]::KeyWhite($pixels, $width, $height, [byte]$Threshold)

$result = New-Object System.Windows.Media.Imaging.WriteableBitmap -ArgumentList $width, $height, 96, 96, ([System.Windows.Media.PixelFormats]::Bgra32), $null
$result.WritePixels([System.Windows.Int32Rect]::new(0, 0, $width, $height), $pixels, $stride, 0)

$outDir = Split-Path $Out -Parent
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}
$encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($result))
$stream = [System.IO.File]::Create($Out)
try {
  $encoder.Save($stream)
} finally {
  $stream.Close()
}

Write-Output ("Wrote {0} ({1}x{2}, {3} background pixels transparent)" -f $Out, $width, $height, $cleared)
