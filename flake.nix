{
  description = "SilverBullet geonotes plug";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [ pkgs.deno ];

          shellHook = ''
            echo "SilverBullet plug dev environment"
            echo "  deno task build  — compile the plug"
          '';
        };
      });
}
