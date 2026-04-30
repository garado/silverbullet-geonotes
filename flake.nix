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
          packages = [ pkgs.nodejs pkgs.nodePackages.npm ];

          shellHook = ''
            echo "SilverBullet plug dev environment"
            echo "  npm install     — install deps (first time)"
            echo "  npm run build   — compile the plug"
          '';
        };
      });
}
