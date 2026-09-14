// Accord 네이티브 화면 캡처 helper (Windows 10 1903+).
// Chromium 화면 캡처기는 CPU 한 코어의 50%를 넘지 않게 스스로 fps를 깎아서(desktop_capture_device.cc) 4K가 약 30fps에 묶인다.
// 이 helper는 Windows.Graphics.Capture로 캡처하고 GPU(D3D11 VideoProcessor)에서 축소 + BGRA→NV12(BT.709 제한 범위) 변환한 뒤
// stdout으로 프레임을 흘린다: 16바이트 헤더(uint32 너비, uint32 높이, int64 타임스탬프 µs) + 빈틈없이 채운 NV12(너비*높이*3/2).
// 사용법: AccordScreenCapture.exe (--monitor X Y | --window HWND) [--max-width W --max-height H] [--fps N]
// 오류는 stderr에 JSON 한 줄({"error":"..."})로 쓴다. stdin이 닫히면(Accord 종료) 같이 끝난다.
#define NOMINMAX
#include <windows.h>
#include <d3d11_4.h>
#include <dxgi1_2.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string_view>
#include <thread>
#include <vector>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "windowsapp.lib")

using namespace winrt;
namespace wgc = winrt::Windows::Graphics::Capture;
namespace wgd = winrt::Windows::Graphics::DirectX;
namespace wgd3d = winrt::Windows::Graphics::DirectX::Direct3D11;

[[noreturn]] static void Fail(const char* message, HRESULT hr = S_OK) {
  if (FAILED(hr)) fprintf(stderr, "{\"error\":\"%s (0x%08X)\"}\n", message, static_cast<unsigned>(hr));
  else fprintf(stderr, "{\"error\":\"%s\"}\n", message);
  fflush(stderr);
  ExitProcess(1);
}

// 모니터가 연결된 GPU에서 캡처해야 GPU 사이 복사가 생기지 않는다. 못 찾으면 nullptr(기본 GPU).
static com_ptr<IDXGIAdapter1> FindAdapter(HMONITOR monitor) {
  com_ptr<IDXGIFactory1> factory;
  check_hresult(CreateDXGIFactory1(IID_PPV_ARGS(factory.put())));
  for (UINT i = 0;; ++i) {
    com_ptr<IDXGIAdapter1> adapter;
    if (factory->EnumAdapters1(i, adapter.put()) == DXGI_ERROR_NOT_FOUND) return nullptr;
    for (UINT j = 0;; ++j) {
      com_ptr<IDXGIOutput> output;
      if (adapter->EnumOutputs(j, output.put()) == DXGI_ERROR_NOT_FOUND) break;
      DXGI_OUTPUT_DESC desc{};
      output->GetDesc(&desc);
      if (desc.Monitor == monitor) return adapter;
    }
  }
}

struct Converter {
  UINT inW = 0, inH = 0, outW = 0, outH = 0;
  com_ptr<ID3D11Texture2D> input, nv12, staging;
  com_ptr<ID3D11VideoProcessorEnumerator> enumerator;
  com_ptr<ID3D11VideoProcessor> processor;
  com_ptr<ID3D11VideoProcessorInputView> inputView;
  com_ptr<ID3D11VideoProcessorOutputView> outputView;
};

// 입력 크기에 맞춘 GPU 변환기: 캡처 텍스처 복사본 → (축소 + NV12 변환) → CPU로 읽을 스테이징 텍스처.
static Converter MakeConverter(ID3D11Device* device, ID3D11VideoContext1* videoContext, UINT inW, UINT inH, UINT maxW, UINT maxH) {
  Converter c;
  c.inW = inW;
  c.inH = inH;
  // 설정 해상도 안에 비율을 유지해 맞춘다(확대는 하지 않는다). NV12는 짝수 크기여야 한다.
  const double scale = maxW && maxH ? std::min({1.0, double(maxW) / inW, double(maxH) / inH}) : 1.0;
  c.outW = std::max(2u, UINT(inW * scale) & ~1u);
  c.outH = std::max(2u, UINT(inH * scale) & ~1u);

  D3D11_TEXTURE2D_DESC td{};
  td.Width = inW;
  td.Height = inH;
  td.MipLevels = 1;
  td.ArraySize = 1;
  td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  td.SampleDesc.Count = 1;
  td.Usage = D3D11_USAGE_DEFAULT;
  td.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  check_hresult(device->CreateTexture2D(&td, nullptr, c.input.put()));
  td.Width = c.outW;
  td.Height = c.outH;
  td.Format = DXGI_FORMAT_NV12;
  td.BindFlags = D3D11_BIND_RENDER_TARGET;
  check_hresult(device->CreateTexture2D(&td, nullptr, c.nv12.put()));
  td.Usage = D3D11_USAGE_STAGING;
  td.BindFlags = 0;
  td.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  check_hresult(device->CreateTexture2D(&td, nullptr, c.staging.put()));

  com_ptr<ID3D11VideoDevice> videoDevice;
  check_hresult(device->QueryInterface(IID_PPV_ARGS(videoDevice.put())));
  D3D11_VIDEO_PROCESSOR_CONTENT_DESC cd{};
  cd.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
  cd.InputWidth = inW;
  cd.InputHeight = inH;
  cd.OutputWidth = c.outW;
  cd.OutputHeight = c.outH;
  cd.InputFrameRate = {60, 1};
  cd.OutputFrameRate = {60, 1};
  cd.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
  check_hresult(videoDevice->CreateVideoProcessorEnumerator(&cd, c.enumerator.put()));
  check_hresult(videoDevice->CreateVideoProcessor(c.enumerator.get(), 0, c.processor.put()));
  D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC ivd{};
  ivd.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
  check_hresult(videoDevice->CreateVideoProcessorInputView(c.input.get(), c.enumerator.get(), &ivd, c.inputView.put()));
  D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC ovd{};
  ovd.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
  check_hresult(videoDevice->CreateVideoProcessorOutputView(c.nv12.get(), c.enumerator.get(), &ovd, c.outputView.put()));
  // 드라이버 화질 보정은 끄고, 색공간은 BT.709 제한 범위로 맞춘다(렌더러가 만드는 VideoFrame의 colorSpace와 짝).
  videoContext->VideoProcessorSetStreamAutoProcessingMode(c.processor.get(), 0, FALSE);
  videoContext->VideoProcessorSetStreamColorSpace1(c.processor.get(), 0, DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709);
  videoContext->VideoProcessorSetOutputColorSpace1(c.processor.get(), DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709);
  return c;
}

int main(int argc, char** argv) {
  HWND window = nullptr;
  POINT point{};
  UINT maxW = 0, maxH = 0;
  int fps = 30;
  for (int i = 1; i < argc; ++i) {
    const std::string_view arg = argv[i];
    const bool hasValue = i + 1 < argc;
    if (arg == "--window" && hasValue) window = reinterpret_cast<HWND>(static_cast<intptr_t>(_strtoi64(argv[++i], nullptr, 10)));
    else if (arg == "--monitor" && i + 2 < argc) {
      point.x = atoi(argv[++i]);
      point.y = atoi(argv[++i]);
    }
    else if (arg == "--max-width" && hasValue) maxW = static_cast<UINT>(std::max(0, atoi(argv[++i])));
    else if (arg == "--max-height" && hasValue) maxH = static_cast<UINT>(std::max(0, atoi(argv[++i])));
    else if (arg == "--fps" && hasValue) fps = std::clamp(atoi(argv[++i]), 1, 240);
  }

  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);  // --monitor 좌표는 물리 픽셀이다
  init_apartment(apartment_type::multi_threaded);
  try {
    if (window && !IsWindow(window)) Fail("공유할 창을 찾지 못했습니다.");
    const HMONITOR monitor = window ? MonitorFromWindow(window, MONITOR_DEFAULTTOPRIMARY) : MonitorFromPoint(point, MONITOR_DEFAULTTOPRIMARY);
    const auto adapter = FindAdapter(monitor);
    com_ptr<ID3D11Device> device;
    com_ptr<ID3D11DeviceContext> context;
    check_hresult(D3D11CreateDevice(adapter.get(), adapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE, nullptr,
                                    D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, nullptr, 0,
                                    D3D11_SDK_VERSION, device.put(), nullptr, context.put()));
    device.as<ID3D10Multithread>()->SetMultithreadProtected(TRUE);
    const auto videoContext = context.as<ID3D11VideoContext1>();
    com_ptr<::IInspectable> inspectable;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(device.as<IDXGIDevice>().get(), inspectable.put()));
    const auto captureDevice = inspectable.as<wgd3d::IDirect3DDevice>();

    const auto interop = get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    wgc::GraphicsCaptureItem item{nullptr};
    if (window) check_hresult(interop->CreateForWindow(window, guid_of<wgc::IGraphicsCaptureItem>(), put_abi(item)));
    else check_hresult(interop->CreateForMonitor(monitor, guid_of<wgc::IGraphicsCaptureItem>(), put_abi(item)));

    constexpr auto format = wgd::DirectXPixelFormat::B8G8R8A8UIntNormalized;
    auto poolSize = item.Size();
    const auto pool = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(captureDevice, format, 2, poolSize);
    const auto session = pool.CreateCaptureSession(item);
    try { session.IsBorderRequired(false); } catch (...) {}  // 노란 테두리 끄기(지원하는 Windows에서만)

    const HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    const int64_t interval = 10'000'000 / fps;  // 100ns 단위
    int64_t nextDue = 0;
    std::mutex lock;
    Converter conv;
    std::vector<uint8_t> packet;

    item.Closed([](wgc::GraphicsCaptureItem const&, winrt::Windows::Foundation::IInspectable const&) {
      Fail("공유하던 창이나 모니터가 닫혔습니다.");
    });
    // 창을 닫아도 Closed가 오지 않는 경우가 있어(시험에서 확인) 창이 살아 있는지 직접 본다.
    if (window) std::thread([window] {
      while (IsWindow(window)) Sleep(500);
      Fail("공유하던 창이 닫혔습니다.");
    }).detach();
    pool.FrameArrived([&](wgc::Direct3D11CaptureFramePool const& sender, winrt::Windows::Foundation::IInspectable const&) {
      std::lock_guard guard(lock);
      try {
        const auto frame = sender.TryGetNextFrame();
        if (!frame) return;
        const auto size = frame.ContentSize();
        if (size.Width < 2 || size.Height < 2) return;  // 최소화된 창
        com_ptr<ID3D11Texture2D> texture;
        check_hresult(frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>()->GetInterface(IID_PPV_ARGS(texture.put())));
        D3D11_TEXTURE2D_DESC desc{};
        texture->GetDesc(&desc);
        if (desc.Width != UINT(size.Width) || desc.Height != UINT(size.Height)) {
          // 창 크기나 화면 해상도가 바뀌었다: 새 크기로 풀을 다시 만들고 이 프레임은 버린다.
          if (size != poolSize) {
            poolSize = size;
            pool.Recreate(captureDevice, format, 2, poolSize);
          }
          return;
        }
        const int64_t now = frame.SystemRelativeTime().count();
        if (now < nextDue - interval / 8) return;  // 설정 fps보다 빨리 온 프레임(고주사율 모니터)은 건너뛴다
        nextDue = now - nextDue > interval ? now + interval : nextDue + interval;

        if (conv.inW != desc.Width || conv.inH != desc.Height) {
          conv = MakeConverter(device.get(), videoContext.get(), desc.Width, desc.Height, maxW, maxH);
        }
        context->CopyResource(conv.input.get(), texture.get());
        D3D11_VIDEO_PROCESSOR_STREAM stream{};
        stream.Enable = TRUE;
        stream.pInputSurface = conv.inputView.get();
        check_hresult(videoContext->VideoProcessorBlt(conv.processor.get(), conv.outputView.get(), 0, 1, &stream));
        context->CopyResource(conv.staging.get(), conv.nv12.get());
        D3D11_MAPPED_SUBRESOURCE mapped{};
        check_hresult(context->Map(conv.staging.get(), 0, D3D11_MAP_READ, 0, &mapped));
        // 매핑된 NV12는 Y 평면 바로 뒤에 UV 평면이 같은 RowPitch로 이어진다. 줄 끝 여백만 빼고 붙인다.
        const UINT rows = conv.outH * 3 / 2;
        packet.resize(16 + size_t(conv.outW) * rows);
        const uint32_t dims[2] = {conv.outW, conv.outH};
        const int64_t micros = now / 10;
        memcpy(packet.data(), dims, 8);
        memcpy(packet.data() + 8, &micros, 8);
        const auto* src = static_cast<const uint8_t*>(mapped.pData);
        for (UINT y = 0; y < rows; ++y) memcpy(packet.data() + 16 + size_t(y) * conv.outW, src + size_t(y) * mapped.RowPitch, conv.outW);
        context->Unmap(conv.staging.get(), 0);
        // Accord가 밀려 파이프가 막히면 여기서 기다린다. 그동안 WGC 풀(2장)이 차서 새 프레임은 버려지므로 지연이 쌓이지 않는다.
        DWORD written = 0;
        if (!WriteFile(out, packet.data(), DWORD(packet.size()), &written, nullptr)) ExitProcess(0);  // Accord가 파이프를 닫았다
      } catch (hresult_error const& e) {
        Fail("화면 캡처 중 오류가 났습니다.", e.code());
      }
    });
    session.StartCapture();

    char byte;
    DWORD read = 0;
    while (ReadFile(GetStdHandle(STD_INPUT_HANDLE), &byte, 1, &read, nullptr) && read) {}
    ExitProcess(0);
  } catch (hresult_error const& e) {
    Fail("화면 캡처를 시작하지 못했습니다.", e.code());
  }
}
