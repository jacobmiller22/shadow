class Shadow < Formula
  desc "Ultra-low latency, local-first issue engine & task tracking CLI"
  homepage "https://github.com/jacobmiller22/shadow"
  version "2.0.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/jacobmiller22/shadow/releases/download/v2.0.0/shadow-darwin-arm64"
      sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" # Placeholder until release tag
    else
      url "https://github.com/jacobmiller22/shadow/releases/download/v2.0.0/shadow-darwin-x64"
      sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/jacobmiller22/shadow/releases/download/v2.0.0/shadow-linux-arm64"
      sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    else
      url "https://github.com/jacobmiller22/shadow/releases/download/v2.0.0/shadow-linux-x64"
      sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    end
  end

  def install
    binary_name = OS.mac? ? (Hardware::CPU.arm? ? "shadow-darwin-arm64" : "shadow-darwin-x64") : (Hardware::CPU.arm? ? "shadow-linux-arm64" : "shadow-linux-x64")
    bin.install binary_name => "shadow"
  end

  test do
    assert_match "Shadow: Ultra-low latency", shell_output("#{bin}/shadow --help")
  end
end
